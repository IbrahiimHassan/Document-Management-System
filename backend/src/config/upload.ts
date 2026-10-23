import path from "node:path";
import { env } from "./env.js";

export const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

export const maxUploadBytes = env.MAX_UPLOAD_MB * 1024 * 1024;

export const allowedTypes: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};