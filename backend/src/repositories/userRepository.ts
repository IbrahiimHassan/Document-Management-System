import { pool } from "../config/database.js";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "admin" | "manager" | "employee";
  departmentId: string;
  departmentName: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "admin" | "manager" | "employee";
  department_id: string;
  department_name: string;
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    departmentId: row.department_id,
    departmentName: row.department_name,
  };
}

const SELECT_USER = `
  SELECT u.id, u.name, u.email, u.password_hash, u.role,
         u.department_id, d.name AS department_name
  FROM users u
  JOIN departments d ON d.id = u.department_id`;

export async function findByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `${SELECT_USER} WHERE u.email = $1`,
    [email.toLowerCase()],
  );
  const row = result.rows[0];
  return row ? toUserRecord(row) : null;
}

export async function findById(id: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(`${SELECT_USER} WHERE u.id = $1`, [id]);
  const row = result.rows[0];
  return row ? toUserRecord(row) : null;
}

// How many people could open a document with these settings: everyone for a
// public one; otherwise admins, the uploader, and members of the chosen departments.
export async function countAudience(input: {
  uploaderId: string;
  visibility: "public" | "restricted";
  departmentIds: string[];
}): Promise<number> {
  const result =
    input.visibility === "public"
      ? await pool.query<{ count: string }>("SELECT count(*) FROM users")
      : await pool.query<{ count: string }>(
          `SELECT count(*) FROM users
           WHERE role = 'admin' OR id = $1 OR department_id = ANY($2::uuid[])`,
          [input.uploaderId, input.departmentIds],
        );
  return Number(result.rows[0]!.count);
}
