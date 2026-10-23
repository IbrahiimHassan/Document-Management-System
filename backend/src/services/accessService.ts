import { ForbiddenError, NotFoundError } from "../errors/AppError.js";
import * as documentRepository from "../repositories/documentRepository.js";
import type { DocumentAccessInfo } from "../repositories/documentRepository.js";
import type { PublicUser } from "./authService.js";

export function canView(user: PublicUser, doc: DocumentAccessInfo): boolean {
  if (user.role === "admin") return true;
  if (doc.uploaderId === user.id) return true;
  if (doc.visibility === "public") return true;
  return doc.allowedDepartmentIds.includes(user.departmentId);
}

export function canManage(user: PublicUser, doc: DocumentAccessInfo): boolean {
  return user.role === "admin" || doc.uploaderId === user.id;
}

// Use when the user must be able to see the document at all.
// Unknown AND hidden documents both give 404, so existence isn't leaked.
export async function requireViewAccess(
  user: PublicUser,
  documentId: string,
): Promise<DocumentAccessInfo> {
  const doc = await documentRepository.findAccessInfo(documentId);
  if (!doc || !canView(user, doc)) {
    throw new NotFoundError("Document not found");
  }
  return doc;
}

// Use for changes (delete, edit). The user can already see it, but may not change it.
export async function requireManageAccess(
  user: PublicUser,
  documentId: string,
): Promise<DocumentAccessInfo> {
  const doc = await requireViewAccess(user, documentId);
  if (!canManage(user, doc)) {
    throw new ForbiddenError("Only the uploader or an admin can change this document");
  }
  return doc;
}