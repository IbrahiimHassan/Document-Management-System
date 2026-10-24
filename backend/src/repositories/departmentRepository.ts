import { pool } from "../config/database.js";

export interface DepartmentRecord {
  id: string;
  name: string;
}

export async function list(): Promise<DepartmentRecord[]> {
  const result = await pool.query<DepartmentRecord>(
    "SELECT id, name FROM departments ORDER BY name",
  );
  return result.rows;
}

// Returns the subset of ids that exist, so callers can spot unknown ones
export async function findExistingIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM departments WHERE id = ANY($1::uuid[])",
    [ids],
  );
  return result.rows.map((row) => row.id);
}
