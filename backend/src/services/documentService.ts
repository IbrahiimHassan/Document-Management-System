import { createHash } from "node:crypto";
import * as documentRepository from "../repositories/documentRepository.js";
import * as fileStorage from "../storage/fileStorage.js";
import type { UploadedFileInfo } from "../middleware/upload.js";
import type { CreateDocumentInput } from "../schemas/documentSchemas.js";
import type { PublicUser } from "./authService.js";
import * as accessService from "./accessService.js";

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