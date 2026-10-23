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