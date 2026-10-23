import { createHash } from "node:crypto";
import * as documentRepository from "../repositories/documentRepository.js";
import * as fileStorage from "../storage/fileStorage.js";
import type { UploadedFileInfo } from "../middleware/upload.js";
import type { CreateDocumentInput } from "../schemas/documentSchemas.js";
import type { PublicUser } from "./authService.js";
import * as accessService from "./accessService.js";
import type { ListDocumentsQuery } from "../schemas/documentSchemas.js";
import { NotFoundError } from "../errors/AppError.js";

export async function createDocument(
  user: PublicUser,
  input: CreateDocumentInput,
  file: UploadedFileInfo,
) {
  const checksumSha256 = createHash("sha256").update(file.buffer).digest("hex");

  const storageKey = await fileStorage.saveFile(file.buffer, file.extension);

  try {
    return await documentRepository.createDocumentWithFirstVersion({
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

  try {
    return await documentRepository.addVersion(documentId, {
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
}

export async function listDocuments(user: PublicUser, query: ListDocumentsQuery) {
  const { items, total } = await documentRepository.search(user, {
    q: query.q,
    tags: query.tags,
    uploader: query.uploader,
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function getDocument(user: PublicUser, documentId: string) {
  await accessService.requireViewAccess(user, documentId);
  const detail = await documentRepository.findDetail(documentId);
  if (!detail) {
    throw new NotFoundError("Document not found");
  }
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

  const info = await documentRepository.findDownloadInfo(documentId, versionNumber);
  if (!info) {
    throw new NotFoundError("Version not found");
  }

  if (!(await fileStorage.fileExists(info.storageKey))) {
    console.error(`File missing on disk for storage key ${info.storageKey}`);
    throw new NotFoundError("The file for this version is no longer available");
  }

  return { ...info, stream: fileStorage.openFile(info.storageKey) };
}