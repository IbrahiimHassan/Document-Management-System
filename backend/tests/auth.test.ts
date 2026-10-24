import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import { pool } from "../src/config/database.js";
import { PASSWORD, createUser, loginAs, resetDb, seedWorld } from "./helpers.js";

let world: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  await resetDb();
  world = await seedWorld();
});

afterAll(async () => {
  await pool.end();
});

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials and sets a safe cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "finance@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "finance@example.com",
      role: "manager",
      departmentName: "Finance",
    });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("password_hash");

    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("accepts the email in any letter case", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "  FINANCE@Example.com ", password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "finance@example.com", password: "wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("gives the same answer for an unknown email as for a wrong password", async () => {
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "finance@example.com", password: "wrong" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong" });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("does the same password work when the email is unknown (no timing leak)", async () => {
    const compare = vi.spyOn(bcrypt, "compare");

    await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever" });

    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });

  it.each([
    ["missing email", { password: PASSWORD }],
    ["missing password", { email: "finance@example.com" }],
    ["invalid email", { email: "not-an-email", password: PASSWORD }],
    ["empty body", {}],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await request(app).post("/api/auth/login").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user when logged in", async () => {
    const agent = await loginAs("legal@example.com");
    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("legal@example.com");
    expect(res.body.user.departmentName).toBe("Legal");
  });

  it("rejects a request with no cookie", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Authentication required");
  });

  it("rejects a garbage token", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "token=garbage");

    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign(
      { sub: world.users.finance, exp: Math.floor(Date.now() / 1000) - 10 },
      env.JWT_SECRET,
    );
    const res = await request(app).get("/api/auth/me").set("Cookie", `token=${expired}`);

    expect(res.status).toBe(401);
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = jwt.sign({ sub: world.users.admin }, "x".repeat(40));
    const res = await request(app).get("/api/auth/me").set("Cookie", `token=${forged}`);

    expect(res.status).toBe(401);
  });

  it("rejects a valid token once the user has been deleted", async () => {
    const id = await createUser({
      name: "Temp User",
      email: "temp@example.com",
      role: "employee",
      departmentId: world.departments.hr,
    });
    const agent = await loginAs("temp@example.com");
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const agent = await loginAs("hr@example.com");
    const res = await agent.post("/api/auth/logout");

    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/token=;/);
  });
});

describe("routes that need a login", () => {
  it.each([
    ["get", "/api/documents"],
    ["get", "/api/documents/123e4567-e89b-42d3-a456-426614174000"],
    ["get", "/api/departments"],
    ["post", "/api/documents"],
    ["post", "/api/documents/123e4567-e89b-42d3-a456-426614174000/versions"],
  ] as const)("%s %s returns 401 without a cookie", async (method, path) => {
    const res = await request(app)[method](path);

    expect(res.status).toBe(401);
  });
});