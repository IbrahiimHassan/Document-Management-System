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

export interface SearchFilters {
  q?: string | undefined;
  tags: string[];
  uploader?: string | undefined;
  limit: number;
  offset: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploaderId: string;
  uploaderName: string;
  tags: string[];
  currentVersion: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

interface SummaryRow {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploader_id: string;
  uploader_name: string;
  tags: string[];
  current_version: number;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: Date;
  updated_at: Date;
}

export async function search(
  user: { id: string; role: string; departmentId: string },
  filters: SearchFilters,
): Promise<{ items: DocumentSummary[]; total: number }> {
  const params: unknown[] = [user.id, user.role === "admin", user.departmentId];
  const conditions: string[] = [
    `(
      $2::boolean
      OR d.uploader_id = $1
      OR d.visibility = 'public'
      OR EXISTS (
        SELECT 1 FROM document_permissions dp
        WHERE dp.document_id = d.id AND dp.department_id = $3
      )
    )`,
  ];

  if (filters.q) {
    params.push(`%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`d.title ILIKE $${params.length}`);
  }

  if (filters.uploader) {
    params.push(`%${filters.uploader.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`u.name ILIKE $${params.length}`);
  }

  if (filters.tags.length > 0) {
    params.push(filters.tags);
    const tagsParam = `$${params.length}`;
    params.push(filters.tags.length);
    conditions.push(
      `(
        SELECT count(DISTINCT t.id)
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = d.id AND lower(t.name) = ANY(${tagsParam}::text[])
      ) = $${params.length}::int`,
    );
  }

  const where = conditions.join(" AND ");

  const countResult = await pool.query<{ total: string }>(
    `SELECT count(*) AS total
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]!.total);

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const result = await pool.query<SummaryRow>(
    `SELECT d.id, d.title, d.description, d.visibility,
            d.uploader_id, u.name AS uploader_name,
            COALESCE(
              (SELECT array_agg(t.name ORDER BY t.name)
               FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.document_id = d.id),
              '{}'
            ) AS tags,
            v.version_number AS current_version,
            v.original_name, v.mime_type, v.size_bytes,
            d.created_at, d.updated_at
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     JOIN LATERAL (
       SELECT version_number, original_name, mime_type, size_bytes
       FROM document_versions
       WHERE document_id = d.id
       ORDER BY version_number DESC
       LIMIT 1
     ) v ON true
     WHERE ${where}
     ORDER BY d.updated_at DESC, d.id
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  return {
    total,
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      visibility: row.visibility,
      uploaderId: row.uploader_id,
      uploaderName: row.uploader_name,
      tags: row.tags,
      currentVersion: row.current_version,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
  };
}

export interface DocumentDetail extends DocumentSummary {
  allowedDepartments: { id: string; name: string }[];
}

export interface VersionRecord {
  id: string;
  versionNumber: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
}

export async function findDetail(documentId: string): Promise<DocumentDetail | null> {
  const result = await pool.query<SummaryRow>(
    `SELECT d.id, d.title, d.description, d.visibility,
            d.uploader_id, u.name AS uploader_name,
            COALESCE(
              (SELECT array_agg(t.name ORDER BY t.name)
               FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.document_id = d.id),
              '{}'
            ) AS tags,
            v.version_number AS current_version,
            v.original_name, v.mime_type, v.size_bytes,
            d.created_at, d.updated_at
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     JOIN LATERAL (
       SELECT version_number, original_name, mime_type, size_bytes
       FROM document_versions
       WHERE document_id = d.id
       ORDER BY version_number DESC
       LIMIT 1
     ) v ON true
     WHERE d.id = $1`,
    [documentId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const departments = await pool.query<{ id: string; name: string }>(
    `SELECT dep.id, dep.name
     FROM document_permissions dp
     JOIN departments dep ON dep.id = dp.department_id
     WHERE dp.document_id = $1
     ORDER BY dep.name`,
    [documentId],
  );

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    tags: row.tags,
    currentVersion: row.current_version,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    allowedDepartments: departments.rows,
  };
}

export async function listVersions(documentId: string): Promise<VersionRecord[]> {
  const result = await pool.query<{
    id: string;
    version_number: number;
    original_name: string;
    mime_type: string;
    size_bytes: string;
    checksum_sha256: string;
    uploaded_by: string;
    uploaded_by_name: string;
    created_at: Date;
  }>(
    `SELECT v.id, v.version_number, v.original_name, v.mime_type,
            v.size_bytes, v.checksum_sha256, v.uploaded_by,
            u.name AS uploaded_by_name, v.created_at
     FROM document_versions v
     JOIN users u ON u.id = v.uploaded_by
     WHERE v.document_id = $1
     ORDER BY v.version_number DESC`,
    [documentId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    uploadedById: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at.toISOString(),
  }));
}

export interface DownloadInfo {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

// versionNumber omitted -> the current (highest) version
export async function findDownloadInfo(
  documentId: string,
  versionNumber?: number,
): Promise<DownloadInfo | null> {
  const result = await pool.query<{
    storage_key: string;
    original_name: string;
    mime_type: string;
    size_bytes: string;
  }>(
    `SELECT storage_key, original_name, mime_type, size_bytes
     FROM document_versions
     WHERE document_id = $1
       AND ($2::int IS NULL OR version_number = $2::int)
     ORDER BY version_number DESC
     LIMIT 1`,
    [documentId, versionNumber ?? null],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
  };
}