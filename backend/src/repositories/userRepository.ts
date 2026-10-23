import { pool } from "../config/database.js";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "admin" | "manager" | "employee";
  departmentId: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "admin" | "manager" | "employee";
  department_id: string;
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    departmentId: row.department_id,
  };
}

export async function findByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, role, department_id
     FROM users
     WHERE email = $1`,
    [email.toLowerCase()],
  );
  const row = result.rows[0];
  return row ? toUserRecord(row) : null;
}

export async function findById(id: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, role, department_id
     FROM users
     WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toUserRecord(row) : null;
}