import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile as readFromDisk, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
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

// The whole file in memory (uploads are at most a few MB)
export function readFile(storageKey: string): Promise<Buffer> {
  return readFromDisk(path.join(uploadDir, path.basename(storageKey)));
}

export function openFile(storageKey: string) {
  return createReadStream(path.join(uploadDir, path.basename(storageKey)));
}

export async function fileExists(storageKey: string): Promise<boolean> {
  try {
    await access(path.join(uploadDir, path.basename(storageKey)));
    return true;
  } catch {
    return false;
  }
}

// SHA-256 of the stored file, read as a stream so big files don't fill memory.
// null when the file is gone.
export async function hashFile(storageKey: string): Promise<string | null> {
  if (!(await fileExists(storageKey))) return null;
  const hash = createHash("sha256");
  await pipeline(openFile(storageKey), hash);
  return hash.digest("hex");
}
