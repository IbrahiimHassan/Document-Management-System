import { createHash } from "node:crypto";
import * as documentRepository from "../repositories/documentRepository.js";
import * as fileStorage from "../storage/fileStorage.js";
import type { UploadedFileInfo } from "../middleware/upload.js";
import type { CreateDocumentInput } from "../schemas/documentSchemas.js";
import type { PublicUser } from "./authService.js";
import * as accessService from "./accessService.js";
import type { ListDocumentsQuery } from "../schemas/documentSchemas.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors/AppError.js";
import * as departmentRepository from "../repositories/departmentRepository.js";
import * as auditRepository from "../repositories/auditRepository.js";
import * as searchCache from "../cache/searchCache.js";

export async function createDocument(
  user: PublicUser,
  input: CreateDocumentInput,
  file: UploadedFileInfo,
) {
  // Checked before the file is written, so a bad id never leaves anything on disk.
  // Public documents ignore departmentIds, so only restricted ones are checked.
  if (input.visibility === "restricted") {
    const existing = await departmentRepository.findExistingIds(input.departmentIds);
    if (existing.length !== input.departmentIds.length) {
      throw new ValidationError("One or more departments do not exist");
    }
  }

  const checksumSha256 = createHash("sha256").update(file.buffer).digest("hex");

  const storageKey = await fileStorage.saveFile(file.buffer, file.extension);

  let created;
  try {
    created = await documentRepository.createDocumentWithFirstVersion({
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
      },
    });
  } catch (error) {
    await fileStorage.deleteFile(storageKey);
    throw error;
  }

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

  const checksumSha256 = createHash("sha256").update(file.buffer).digest("hex");
  const storageKey = await fileStorage.saveFile(file.buffer, file.extension);

  let created;
  try {
    created = await documentRepository.addVersion(documentId, {
      storageKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.size,
      checksumSha256,
      uploadedBy: user.id,
    });
  } catch (error) {
    await fileStorage.deleteFile(storageKey);
    throw error;
  }

  // A new version changes the current file name, size and the sort order
  await searchCache.invalidateAll();
  return created;
}

export interface DocumentPage {
  items: documentRepository.DocumentSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listDocuments(user: PublicUser, query: ListDocumentsQuery): Promise<DocumentPage> {
  const cacheKey = await searchCache.keyFor(user, query);
  if (cacheKey) {
    const cached = await searchCache.read<DocumentPage>(cacheKey);
    if (cached) return cached;
  }

  const { items, total } = await documentRepository.search(user, {
    q: query.q,
    tags: query.tags,
    uploader: query.uploader,
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  const result = {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };

  if (cacheKey) await searchCache.write(cacheKey, result);
  return result;
}

export async function getDocument(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);
  const detail = await documentRepository.findDetail(documentId);
  if (!detail) {
    throw new NotFoundError("Document not found");
  }
  await auditRepository.record({ documentId, userId: user.id, action: "view" });
  return detail;
}

export async function getVersions(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);
  return documentRepository.listVersions(documentId);
}

export async function getDownload(
  user: PublicUser,
  documentId: string,
  versionNumber?: number,
) {
  await accessService.requireViewAccess(user, documentId);

  const info = await documentRepository.findCurrentDownloadInfo(documentId);
  if (!info) {
    throw new NotFoundError("Version not found");
  }

  // A new version replaces the old ones: they stay in the history but can't be downloaded.
  // Version numbers run 1..current with no gaps, so anything above current doesn't exist.
  if (versionNumber !== undefined && versionNumber !== info.versionNumber) {
    if (versionNumber > info.versionNumber) {
      throw new NotFoundError("Version not found");
    }
    throw new ForbiddenError("Only the current version can be downloaded");
  }

  if (!(await fileStorage.fileExists(info.storageKey))) {
    console.error(`File missing on disk for storage key ${info.storageKey}`);
    throw new NotFoundError("The file for this version is no longer available");
  }

  // Recorded only once we know the file can actually be served
  await auditRepository.record({
    documentId,
    userId: user.id,
    action: "download",
    versionNumber: info.versionNumber,
  });

  return { ...info, stream: fileStorage.openFile(info.storageKey) };
}

// Only the uploader or an admin may see who opened their document
export async function getAuditLog(user: PublicUser, documentId: string) {
  await accessService.requireManageAccess(user, documentId);
  return auditRepository.listForDocument(documentId, 100);
}