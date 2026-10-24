import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import * as cache from "../src/cache/cache.js";
import { pool } from "../src/config/database.js";

beforeAll(async () => {
  await cache.ready();
});

afterAll(async () => {
  await pool.end();
});

describe("health and error shape", () => {
  it("reports the database as connected", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      service: "document-repository-api",
      database: "connected",
      cache: "connected",
    });
  });

  it("returns the standard error shape for unknown routes", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});