import { createHash } from "node:crypto";
import * as documentRepository from "../repositories/documentRepository.js";
import * as fileStorage from "../storage/fileStorage.js";
import type { UploadedFileInfo } from "../middleware/upload.js";
import type { CreateDocumentInput, UpdateDocumentInput } from "../schemas/documentSchemas.js";
import type { PublicUser } from "./authService.js";
import * as accessService from "./accessService.js";
import type { ListDocumentsQuery } from "../schemas/documentSchemas.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreviewFailedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../errors/AppError.js";
import * as departmentRepository from "../repositories/departmentRepository.js";
import * as auditRepository from "../repositories/auditRepository.js";
import * as userRepository from "../repositories/userRepository.js";
import * as searchCache from "../cache/searchCache.js";
import * as virusScanner from "../files/virusScanner.js";
import { extractText } from "../files/textExtraction.js";
import * as previewRendering from "../files/previewRendering.js";

async function requireDepartmentsExist(departmentIds: string[]): Promise<void> {
  const existing = await departmentRepository.findExistingIds(departmentIds);
  if (existing.length !== departmentIds.length) {
    throw new ValidationError("One or more departments do not exist");
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Writes the file, runs `store` with its storage key, and deletes the file again
// if storing the database rows fails, so no orphan file is left behind.
async function saveThen<T>(file: UploadedFileInfo, store: (storageKey: string) => Promise<T>): Promise<T> {
  const storageKey = await fileStorage.saveFile(file.buffer, file.extension);
  try {
    return await store(storageKey);
  } catch (error) {
    await fileStorage.deleteFile(storageKey);
    throw error;
  }
}

export async function createDocument(
  user: PublicUser,
  input: CreateDocumentInput,
  file: UploadedFileInfo,
) {
  // Checked before the file is written, so a bad id never leaves anything on disk.
  // Public documents ignore departmentIds, so only restricted ones are checked.
  if (input.visibility === "restricted") {
    await requireDepartmentsExist(input.departmentIds);
  }

  // Scanned before anything is stored: an infected file never reaches the disk
  await virusScanner.assertClean(file.buffer, file.originalName);

  const checksumSha256 = sha256(file.buffer);
  const contentText = await extractText(file.buffer, file.mimeType);

  const created = await saveThen(file, (storageKey) =>
    documentRepository.createDocumentWithFirstVersion({
      title: input.title,
      description: input.description,
      visibility: input.visibility,
      uploaderId: user.id,
      tags: input.tags,
      departmentIds: input.departmentIds,
      version: {
        storageKey,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        checksumSha256,
        uploadedBy: user.id,
        contentText,
      },
    }),
  );

  await searchCache.invalidateAll();
  return created;
}

export async function addVersion(
  user: PublicUser,
  documentId: string,
  file: UploadedFileInfo,
) {
  // 404 if hidden or missing, 403 if visible but not manageable
  await accessService.requireManageAccess(user, documentId);

  const checksumSha256 = sha256(file.buffer);
  const current = await documentRepository.findCurrentDownloadInfo(documentId);
  if (current && current.checksumSha256 === checksumSha256) {
    throw new ConflictError(
      `This file is identical to the current version (v${current.versionNumber}), so no new version was created`,
    );
  }

  await virusScanner.assertClean(file.buffer, file.originalName);
  const contentText = await extractText(file.buffer, file.mimeType);

  const created = await saveThen(file, (storageKey) =>
    documentRepository.addVersion(documentId, {
      storageKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.size,
      checksumSha256,
      uploadedBy: user.id,
      contentText,
    }),
  );

  // A new version changes the current file name, size, text and the sort order
  await searchCache.invalidateAll();
  return created;
}

export interface DocumentListItem extends documentRepository.DocumentSummary {
  // The highest version this user downloaded, null if never. When it is lower
  // than currentVersion, the file changed since they last downloaded it.
  lastDownloadedVersion: number | null;
}

export interface DocumentPage {
  items: DocumentListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type CachedPage = Omit<DocumentPage, "items"> & { items: documentRepository.DocumentSummary[] };

export async function listDocuments(user: PublicUser, query: ListDocumentsQuery): Promise<DocumentPage> {
  let page: CachedPage | null = null;

  const cacheKey = await searchCache.keyFor(user, query);
  if (cacheKey) {
    page = await searchCache.read<CachedPage>(cacheKey);
  }

  if (!page) {
    const { items, total } = await documentRepository.search(user, {
      q: query.q,
      tags: query.tags,
      uploader: query.uploader,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });

    page = {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };

    if (cacheKey) await searchCache.write(cacheKey, page);
  }

  // Personal and always changing (every download), so it is added after the
  // cache instead of being stored in it. One small indexed query per page.
  const downloaded = await auditRepository.lastDownloadedVersions(
    user.id,
    page.items.map((item) => item.id),
  );
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      lastDownloadedVersion: downloaded.get(item.id) ?? null,
    })),
  };
}

async function detailFor(user: PublicUser, documentId: string) {
  const detail = await documentRepository.findDetail(documentId);
  if (!detail) {
    throw new NotFoundError("Document not found");
  }
  const downloaded = await auditRepository.lastDownloadedVersions(user.id, [documentId]);
  return { ...detail, lastDownloadedVersion: downloaded.get(documentId) ?? null };
}

export async function getDocument(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);
  const detail = await detailFor(user, documentId);
  await auditRepository.record({ documentId, userId: user.id, action: "view" });
  return detail;
}

export async function getVersions(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);
  return documentRepository.listVersions(documentId);
}

async function requireCurrentVersion(documentId: string) {
  const info = await documentRepository.findCurrentDownloadInfo(documentId);
  if (!info) {
    throw new NotFoundError("Version not found");
  }
  return info;
}

// Shared by download and preview: the database row can outlive the file
async function requireOnDisk(info: documentRepository.DownloadInfo): Promise<void> {
  if (!(await fileStorage.fileExists(info.storageKey))) {
    console.error(`File missing on disk for storage key ${info.storageKey}`);
    throw new NotFoundError("The file for this version is no longer available");
  }
}

export async function getDownload(
  user: PublicUser,
  documentId: string,
  versionNumber?: number,
) {
  await accessService.requireViewAccess(user, documentId);

  const info = await requireCurrentVersion(documentId);

  // A new version replaces the old ones: they stay in the history but can't be downloaded.
  // Version numbers run 1..current with no gaps, so anything above current doesn't exist.
  if (versionNumber !== undefined && versionNumber !== info.versionNumber) {
    if (versionNumber > info.versionNumber) {
      throw new NotFoundError("Version not found");
    }
    throw new ForbiddenError("Only the current version can be downloaded");
  }

  await requireOnDisk(info);

  // Recorded only once we know the file can actually be served
  await auditRepository.record({
    documentId,
    userId: user.id,
    action: "download",
    versionNumber: info.versionNumber,
  });

  return { ...info, stream: fileStorage.openFile(info.storageKey) };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The current version, ready to show in a browser tab: PDFs as they are,
// Word and Excel files turned into a read-only web page.
export async function getPreview(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);

  const info = await requireCurrentVersion(documentId);
  await requireOnDisk(info);

  let preview: { kind: "pdf"; stream: ReturnType<typeof fileStorage.openFile> } | { kind: "html"; html: string };
  if (info.mimeType === "application/pdf") {
    preview = { kind: "pdf", stream: fileStorage.openFile(info.storageKey) };
  } else if (info.mimeType === DOCX || info.mimeType === XLSX) {
    const buffer = await fileStorage.readFile(info.storageKey);
    try {
      const html =
        info.mimeType === DOCX
          ? await previewRendering.renderDocx(buffer, info.originalName)
          : previewRendering.renderXlsx(buffer, info.originalName);
      preview = { kind: "html", html };
    } catch (error) {
      if (!(error instanceof previewRendering.PreviewFailedError)) throw error;
      console.warn(`Preview failed for ${info.storageKey}: ${error.message}`);
      throw new PreviewFailedError();
    }
  } else {
    throw new UnsupportedMediaTypeError("This file type can't be previewed. Download it to open it.");
  }

  // Recorded once the preview is ready to send
  await auditRepository.record({
    documentId,
    userId: user.id,
    action: "preview",
    versionNumber: info.versionNumber,
  });

  return { ...info, ...preview };
}

// Only the uploader or an admin may see who opened their document
export async function getAuditLog(user: PublicUser, documentId: string) {
  await accessService.requireManageAccess(user, documentId);
  return auditRepository.listForDocument(documentId, 100);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

export async function updateDocument(user: PublicUser, documentId: string, input: UpdateDocumentInput) {
  await accessService.requireManageAccess(user, documentId);
  const current = await detailFor(user, documentId);

  const visibility = input.visibility ?? current.visibility;
  const currentDepartmentIds = current.allowedDepartments.map((d) => d.id);
  const departmentIds = input.departmentIds ?? currentDepartmentIds;

  if (visibility === "restricted") {
    if (departmentIds.length === 0) {
      throw new ValidationError("A restricted document needs at least one department");
    }
    if (input.departmentIds) {
      await requireDepartmentsExist(input.departmentIds);
    }
  }

  // Only what really differs is written and recorded
  const changes: documentRepository.DocumentChanges = {};
  const changed: string[] = [];
  if (input.title !== undefined && input.title !== current.title) {
    changes.title = input.title;
    changed.push("title");
  }
  if (input.description !== undefined && input.description !== current.description) {
    changes.description = input.description;
    changed.push("description");
  }
  if (input.tags && !sameSet(input.tags, current.tags)) {
    changes.tags = input.tags;
    changed.push("tags");
  }
  if (visibility !== current.visibility) {
    changes.visibility = visibility;
    changed.push("visibility");
  }
  // Public documents keep no department list, so departments only matter when restricted
  const newDepartments = visibility === "restricted" ? departmentIds : [];
  if (!sameSet(newDepartments, currentDepartmentIds)) {
    changes.departmentIds = newDepartments;
    changed.push("departments");
  }

  if (changed.length === 0) {
    return current;
  }

  const updated = await documentRepository.updateDocument(documentId, changes);
  if (!updated) {
    throw new NotFoundError("Document not found");
  }

  // A new title, tags or permissions change who finds what
  await searchCache.invalidateAll();
  await auditRepository.record({
    documentId,
    userId: user.id,
    action: "edit",
    details: { changes: changed },
  });

  return detailFor(user, documentId);
}

// Soft delete: the document disappears for everyone (404), but its versions,
// files and audit trail are kept and an admin can restore it.
export async function deleteDocument(user: PublicUser, documentId: string): Promise<void> {
  await accessService.requireManageAccess(user, documentId);

  if (!(await documentRepository.softDelete(documentId, user.id))) {
    throw new NotFoundError("Document not found");
  }

  await searchCache.invalidateAll();
  await auditRepository.record({ documentId, userId: user.id, action: "delete" });
}

function requireAdmin(user: PublicUser): void {
  if (user.role !== "admin") {
    throw new ForbiddenError("Only an admin can manage deleted documents");
  }
}

export async function listDeleted(user: PublicUser) {
  requireAdmin(user);
  return documentRepository.listDeleted(100);
}

export async function restoreDocument(user: PublicUser, documentId: string) {
  requireAdmin(user);

  if (!(await documentRepository.restore(documentId))) {
    throw new NotFoundError("No deleted document with this id");
  }

  await searchCache.invalidateAll();
  await auditRepository.record({ documentId, userId: user.id, action: "restore" });
  return detailFor(user, documentId);
}

export type IntegrityStatus = "intact" | "modified" | "missing";

// Re-reads every stored version and compares it with the checksum saved at upload.
// "modified" means the bytes on disk changed after upload (corruption or tampering).
export async function checkIntegrity(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);

  const files = await documentRepository.listVersionFiles(documentId);
  const versions: { versionNumber: number; status: IntegrityStatus; expected: string; actual: string | null }[] = [];

  for (const file of files) {
    const actual = await fileStorage.hashFile(file.storageKey);
    versions.push({
      versionNumber: file.versionNumber,
      status: actual === null ? "missing" : actual === file.checksumSha256 ? "intact" : "modified",
      expected: file.checksumSha256,
      actual,
    });
  }

  return {
    status: versions.every((v) => v.status === "intact") ? ("intact" as const) : ("problem" as const),
    checkedAt: new Date().toISOString(),
    versions,
  };
}

export async function findDuplicates(user: PublicUser, checksum: string) {
  return documentRepository.findByCurrentChecksum(user, checksum);
}

export async function countAudience(
  user: PublicUser,
  input: { visibility: "public" | "restricted"; departmentIds: string[] },
) {
  return userRepository.countAudience({
    uploaderId: user.id,
    visibility: input.visibility,
    departmentIds: input.departmentIds,
  });
}
