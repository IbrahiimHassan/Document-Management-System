import type { Request, Response } from "express";
import { UnauthorizedError, ValidationError } from "../errors/AppError.js";
import { createDocumentSchema, documentIdSchema } from "../schemas/documentSchemas.js";
import * as documentService from "../services/documentService.js";

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