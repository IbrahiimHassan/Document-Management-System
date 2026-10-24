import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { LOGIN_MAX_FAILURES } from "../src/middleware/rateLimit.js";
import { PASSWORD, createUser, resetDb, seedWorld } from "./helpers.js";

let world: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  await resetDb();
  world = await seedWorld();
});

afterAll(async () => {
  await pool.end();
});

describe("malformed request bodies", () => {
  it("answers broken JSON with 400, not 500", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "finance@example.com", "password": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON" },
    });
  });

  it("answers an oversized JSON body with 413", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "a@example.com", password: "x".repeat(200_000) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("security headers", () => {
  it("does not reveal that the server runs Express", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("sends the Helmet headers", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("sends them on error responses too", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("login rate limiting", () => {
  const login = (email: string, password: string) =>
    request(app).post("/api/auth/login").send({ email, password });

  it(`blocks an email after ${LOGIN_MAX_FAILURES} failed attempts with 429`, async () => {
    await createUser({
      name: "Target User",
      email: "target@example.com",
      role: "employee",
      departmentId: world.departments.hr,
    });

    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      expect((await login("target@example.com", `guess-${i}`)).status).toBe(401);
    }

    const blocked = await login("target@example.com", "one-more-guess");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("keeps blocking even with the right password, so guessing can't continue", async () => {
    const res = await login("target@example.com", PASSWORD);

    expect(res.status).toBe(429);
  });

  it("counts the email in any letter case as the same account", async () => {
    const res = await login("  TARGET@example.com ", PASSWORD);

    expect(res.status).toBe(429);
  });

  it("does not block other accounts", async () => {
    const res = await login("legal@example.com", PASSWORD);

    expect(res.status).toBe(200);
  });

  it("never counts successful logins", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES + 5; i++) {
      expect((await login("hr@example.com", PASSWORD)).status).toBe(200);
    }
  });
});
