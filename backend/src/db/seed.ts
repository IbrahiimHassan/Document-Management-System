import bcrypt from "bcryptjs";
import { pool } from "../config/database.js";

const DEMO_PASSWORD = "password123";

const departments = ["Finance", "Legal", "HR"];

const users = [
  { name: "Admin User", email: "admin@example.com", role: "admin", department: "Finance" },
  { name: "Finance Manager", email: "finance@example.com", role: "manager", department: "Finance" },
  { name: "Legal Employee", email: "legal@example.com", role: "employee", department: "Legal" },
  { name: "HR Employee", email: "hr@example.com", role: "employee", department: "HR" },
];

async function seed(): Promise<void> {
  for (const name of departments) {
    await pool.query(
      "INSERT INTO departments (name) VALUES ($1) ON CONFLICT DO NOTHING",
      [name],
    );
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const user of users) {
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       SELECT $1, $2, $3, $4, id FROM departments WHERE lower(name) = lower($5)
       ON CONFLICT (email) DO NOTHING`,
      [user.name, user.email, passwordHash, user.role, user.department],
    );
    console.log(`${result.rowCount ? "created" : "exists "}  ${user.email}`);
  }
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());