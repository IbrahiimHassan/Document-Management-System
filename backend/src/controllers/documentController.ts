import type { Request, Response } from "express";
import { UnauthorizedError, ValidationError } from "../errors/AppError.js";
import { createDocumentSchema, documentIdSchema, listDocumentsQuerySchema} from "../schemas/documentSchemas.js";
import * as documentService from "../services/documentService.js";
import { z } from "zod";

export async function createDocument(req: Request, res: Response): Promise<void> {
  if (!req.user || !req.uploadedFile) {
    throw new UnauthorizedError();
  }

  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  const created = await documentService.createDocument(
    req.user,
    parsed.data,
    req.uploadedFile,
  );

  res.status(201).json(created);
}

export async function addVersion(req: Request, res: Response): Promise<void> {
  if (!req.user || !req.uploadedFile) {
    throw new UnauthorizedError();
  }

  const parsedId = documentIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new ValidationError("Invalid document id");
  }

  const created = await documentService.addVersion(
    req.user,
    parsedId.data,
    req.uploadedFile,
  );

  res.status(201).json(created);
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const parsed = listDocumentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  const result = await documentService.listDocuments(req.user, parsed.data);
  res.status(200).json(result);
}

export async function getDocument(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const parsedId = documentIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new ValidationError("Invalid document id");
  }

  const document = await documentService.getDocument(req.user, parsedId.data);
  res.status(200).json(document);
}

export async function getVersions(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const parsedId = documentIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new ValidationError("Invalid document id");
  }

  const versions = await documentService.getVersions(req.user, parsedId.data);
  res.status(200).json({ items: versions });
}

export async function getAuditLog(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const parsedId = documentIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new ValidationError("Invalid document id");
  }

  const events = await documentService.getAuditLog(req.user, parsedId.data);
  res.status(200).json({ items: events });
}

const downloadQuerySchema = z.object({
  version: z.coerce.number().int("version must be a whole number").min(1, "version must be at least 1").optional(),
});

export async function downloadDocument(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const parsedId = documentIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new ValidationError("Invalid document id");
  }

  const parsedQuery = downloadQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new ValidationError(
      parsedQuery.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  const file = await documentService.getDownload(
    req.user,
    parsedId.data,
    parsedQuery.data.version,
  );

  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", String(file.sizeBytes));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.attachment(file.originalName);

  file.stream.on("error", (error) => {
    console.error("Download stream failed:", error);
    res.destroy(error);
  });
  file.stream.pipe(res);
}