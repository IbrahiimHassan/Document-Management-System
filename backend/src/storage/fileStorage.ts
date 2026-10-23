import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "../config/upload.js";

export async function saveFile(buffer: Buffer, extension: string): Promise<string> {
  await mkdir(uploadDir, { recursive: true });

  const storageKey = `${randomUUID()}.${extension}`;
  await writeFile(path.join(uploadDir, storageKey), buffer, { flag: "wx" });

  return storageKey;
}

export async function deleteFile(storageKey: string): Promise<void> {
  try {
    await unlink(path.join(uploadDir, path.basename(storageKey)));
  } catch (error) {
    console.error(`Could not delete file ${storageKey}:`, error);
  }
}

export function openFile(storageKey: string) {
  return createReadStream(path.join(uploadDir, path.basename(storageKey)));
}