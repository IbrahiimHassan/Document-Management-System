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