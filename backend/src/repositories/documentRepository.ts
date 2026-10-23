import type { PoolClient } from "pg";
import { pool } from "../config/database.js";

export interface DocumentAccessInfo {
  id: string;
  uploaderId: string;
  visibility: "public" | "restricted";
  allowedDepartmentIds: string[];
}

interface AccessRow {
  id: string;
  uploader_id: string;
  visibility: "public" | "restricted";
  allowed_department_ids: string[];
}

export async function findAccessInfo(
  documentId: string,
): Promise<DocumentAccessInfo | null> {
  const result = await pool.query<AccessRow>(
    `SELECT d.id,
            d.uploader_id,
            d.visibility,
            COALESCE(
              array_agg(dp.department_id) FILTER (WHERE dp.department_id IS NOT NULL),
              '{}'
            ) AS allowed_department_ids
     FROM documents d
     LEFT JOIN document_permissions dp ON dp.document_id = d.id
     WHERE d.id = $1
     GROUP BY d.id`,
    [documentId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    uploaderId: row.uploader_id,
    visibility: row.visibility,
    allowedDepartmentIds: row.allowed_department_ids,
  };
}

export interface NewVersionData {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedBy: string;
}

export interface CreateDocumentData {
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploaderId: string;
  tags: string[];
  departmentIds: string[];
  version: NewVersionData;
}

export interface CreatedVersion {
  documentId: string;
  versionId: string;
  versionNumber: number;
}

async function insertVersion(
  client: PoolClient,
  documentId: string,
  versionNumber: number,
  data: NewVersionData,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO document_versions
       (document_id, version_number, storage_key, original_name,
        mime_type, size_bytes, checksum_sha256, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      documentId,
      versionNumber,
      data.storageKey,
      data.originalName,
      data.mimeType,
      data.sizeBytes,
      data.checksumSha256,
      data.uploadedBy,
    ],
  );
  return result.rows[0]!.id;
}

export async function createDocumentWithFirstVersion(
  data: CreateDocumentData,
): Promise<CreatedVersion> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const docResult = await client.query<{ id: string }>(
      `INSERT INTO documents (title, description, uploader_id, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.title, data.description, data.uploaderId, data.visibility],
    );
    const documentId = docResult.rows[0]!.id;

    const versionId = await insertVersion(client, documentId, 1, data.version);

    for (const tag of data.tags) {
      await client.query(
        `INSERT INTO tags (name) VALUES ($1)
         ON CONFLICT (lower(name)) DO NOTHING`,
        [tag],
      );
      await client.query(
        `INSERT INTO document_tags (document_id, tag_id)
         SELECT $1, id FROM tags WHERE lower(name) = lower($2)
         ON CONFLICT DO NOTHING`,
        [documentId, tag],
      );
    }

    if (data.visibility === "restricted") {
      for (const departmentId of data.departmentIds) {
        await client.query(
          `INSERT INTO document_permissions (document_id, department_id)
           VALUES ($1, $2)`,
          [documentId, departmentId],
        );
      }
    }

    await client.query("COMMIT");
    return { documentId, versionId, versionNumber: 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addVersion(
  documentId: string,
  data: NewVersionData,
): Promise<CreatedVersion> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the document row so two simultaneous uploads can't pick the same number
    const lock = await client.query(
      "SELECT id FROM documents WHERE id = $1 FOR UPDATE",
      [documentId],
    );
    if (lock.rowCount === 0) {
      throw new Error("Document disappeared during upload");
    }

    const next = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
       FROM document_versions WHERE document_id = $1`,
      [documentId],
    );
    const versionNumber = next.rows[0]!.next;

    const versionId = await insertVersion(client, documentId, versionNumber, data);

    await client.query(
      "UPDATE documents SET updated_at = now() WHERE id = $1",
      [documentId],
    );

    await client.query("COMMIT");
    return { documentId, versionId, versionNumber };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}