import type { Request, Response } from "express";
import type { ReadStream } from "node:fs";
import { UnauthorizedError, ValidationError } from "../errors/AppError.js";
import {
  audienceQuerySchema,
  createDocumentSchema,
  documentIdSchema,
  duplicateQuerySchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
} from "../schemas/documentSchemas.js";
import * as documentService from "../services/documentService.js";
import { z } from "zod";

function requireUser(req: Request) {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}

function parseDocumentId(req: Request): string {
  const parsed = documentIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new ValidationError("Invalid document id");
  }
  return parsed.data;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
  }
  return parsed.data;
}

export async function createDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  if (!req.uploadedFile) {
    throw new UnauthorizedError();
  }

  const input = parse(createDocumentSchema, req.body);
  const created = await documentService.createDocument(user, input, req.uploadedFile);

  res.status(201).json(created);
}

export async function addVersion(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  if (!req.uploadedFile) {
    throw new UnauthorizedError();
  }

  const created = await documentService.addVersion(user, parseDocumentId(req), req.uploadedFile);
  res.status(201).json(created);
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = parse(listDocumentsQuerySchema, req.query);

  const result = await documentService.listDocuments(user, query);
  res.status(200).json(result);
}

export async function getDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const document = await documentService.getDocument(user, parseDocumentId(req));
  res.status(200).json(document);
}

export async function updateDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = parseDocumentId(req);
  const input = parse(updateDocumentSchema, req.body ?? {});

  const document = await documentService.updateDocument(user, id, input);
  res.status(200).json(document);
}

export async function deleteDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await documentService.deleteDocument(user, parseDocumentId(req));
  res.status(204).end();
}

export async function listDeleted(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const items = await documentService.listDeleted(user);
  res.status(200).json({ items });
}

export async function restoreDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const document = await documentService.restoreDocument(user, parseDocumentId(req));
  res.status(200).json(document);
}

export async function getVersions(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const versions = await documentService.getVersions(user, parseDocumentId(req));
  res.status(200).json({ items: versions });
}

export async function getAuditLog(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const events = await documentService.getAuditLog(user, parseDocumentId(req));
  res.status(200).json({ items: events });
}

export async function checkIntegrity(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await documentService.checkIntegrity(user, parseDocumentId(req));
  res.status(200).json(result);
}

export async function findDuplicates(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { checksum } = parse(duplicateQuerySchema, req.query);

  const items = await documentService.findDuplicates(user, checksum);
  res.status(200).json({ items });
}

export async function countAudience(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = parse(audienceQuerySchema, req.query);

  const userCount = await documentService.countAudience(user, query);
  res.status(200).json({ userCount });
}

const downloadQuerySchema = z.object({
  version: z.coerce.number().int("version must be a whole number").min(1, "version must be at least 1").optional(),
});

interface StoredFile {
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  stream: ReadStream;
}

function sendFile(res: Response, file: StoredFile, disposition: "attachment" | "inline"): void {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", String(file.sizeBytes));
  // The browser must trust the type we send, never guess one from the bytes
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Private documents must not be kept by shared caches or proxies
  res.setHeader("Cache-Control", "private, no-store");
  if (disposition === "attachment") {
    res.attachment(file.originalName);
  } else {
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    // Shown inside our page only. "sandbox" stops any active content in the
    // file from running with the site's cookies or reaching the rest of the app.
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'self'");
  }

  file.stream.on("error", (error) => {
    console.error("File stream failed:", error);
    res.destroy(error);
  });
  file.stream.pipe(res);
}

export async function downloadDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = parseDocumentId(req);
  const { version } = parse(downloadQuerySchema, req.query);

  const file = await documentService.getDownload(user, id, version);
  sendFile(res, file, "attachment");
}

export async function previewDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const preview = await documentService.getPreview(user, parseDocumentId(req));

  if (preview.kind === "pdf") {
    sendFile(res, preview, "inline");
    return;
  }

  // A page we built from a Word or Excel file. It has no scripts; the policy
  // makes sure none could run, and nothing outside the page can be loaded.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'",
  );
  res.type("html").send(preview.html);
}
