import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import * as cache from "../src/cache/cache.js";
import { SEARCH_TTL_SECONDS } from "../src/cache/searchCache.js";
import { pool } from "../src/config/database.js";
import {
  clearUploads,
  createUser,
  insertDocument,
  loginAs,
  pdfBytes,
  resetDb,
  seedWorld,
  uploadTo,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "finance" | "financeColleague" | "legal" | "hr", Agent>;
let handbook: string;

beforeAll(async () => {
  await resetDb();
  await clearUploads();
  world = await seedWorld();
  await createUser({
    name: "Finance Colleague",
    email: "colleague@example.com",
    // Same role AND department as the Finance manager, so only the user id tells them apart
    role: "manager",
    departmentId: world.departments.finance,
  });

  agents = {
    admin: await loginAs("admin@example.com"),
    finance: await loginAs("finance@example.com"),
    financeColleague: await loginAs("colleague@example.com"),
    legal: await loginAs("legal@example.com"),
    hr: await loginAs("hr@example.com"),
  };

  const created = await uploadTo(agents.finance, "/api/documents", { title: "Handbook" });
  handbook = created.body.documentId;

  // Restricted with no departments: only the Finance manager (uploader) and admins see it
  await insertDocument({ title: "Private Note", uploaderId: world.users.finance, visibility: "restricted" });

  // Restricted to Legal
  await insertDocument({
    title: "Legal Memo",
    uploaderId: world.users.admin,
    visibility: "restricted",
    departmentIds: [world.departments.legal],
  });
});

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

const titles = (body: { items: { title: string }[] }) => body.items.map((d) => d.title).sort();

// Changes the database behind the API's back, so only a cache miss would notice
async function renameDirectly(id: string, title: string) {
  await pool.query("UPDATE documents SET title = $2 WHERE id = $1", [id, title]);
}

async function searchKeys(): Promise<string[]> {
  return (await cache.safely((redis) => redis.keys("search:*:*"))) ?? [];
}

describe("search results are cached in Redis", () => {
  it("is connected during the tests", () => {
    expect(cache.status()).toBe("connected");
  });

  it("answers a repeated search from the cache", async () => {
    const first = await agents.hr.get("/api/documents?q=hand");
    await renameDirectly(handbook, "Renamed Behind The Cache");
    const second = await agents.hr.get("/api/documents?q=hand");

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    await renameDirectly(handbook, "Handbook");
  });

  it("stores entries with a short expiry", async () => {
    const keys = await searchKeys();
    expect(keys.length).toBeGreaterThan(0);

    const ttl = await cache.safely((redis) => redis.ttl(keys[0]!));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SEARCH_TTL_SECONDS);
  });

  it("a different filter is a different entry", async () => {
    await agents.hr.get("/api/documents?q=hand");
    await renameDirectly(handbook, "Handbook Two");
    const other = await agents.hr.get("/api/documents?q=handbook%20two");

    expect(titles(other.body)).toEqual(["Handbook Two"]);
    await renameDirectly(handbook, "Handbook");
  });
});

describe("uploads clear the cache", () => {
  it("a new document appears in the very next search", async () => {
    const before = await agents.hr.get("/api/documents");
    await uploadTo(agents.legal, "/api/documents", { title: "Fresh Upload" });
    const after = await agents.hr.get("/api/documents");

    expect(after.body.total).toBe(before.body.total + 1);
    expect(titles(after.body)).toContain("Fresh Upload");
  });

  it("a new version shows up as current in the very next search", async () => {
    const before = await agents.hr.get("/api/documents?q=handbook");
    expect(before.body.items[0].currentVersion).toBe(1);

    await uploadTo(agents.finance, `/api/documents/${handbook}/versions`, {}, {
      buffer: pdfBytes("handbook v2"),
      name: "handbook-v2.pdf",
    });
    const after = await agents.hr.get("/api/documents?q=handbook");

    expect(after.body.items[0]).toMatchObject({ currentVersion: 2, originalName: "handbook-v2.pdf" });
  });
});

describe("the cache never shows a user someone else's results", () => {
  it("a colleague in the same department does not get the uploader's private document", async () => {
    // The Finance manager warms the cache with a result that includes their own private note
    const owner = await agents.finance.get("/api/documents?q=note");
    const colleague = await agents.financeColleague.get("/api/documents?q=note");

    expect(titles(owner.body)).toEqual(["Private Note"]);
    expect(colleague.body.total).toBe(0);
  });

  it("another department does not get a department-only document", async () => {
    const legal = await agents.legal.get("/api/documents?q=memo");
    const hr = await agents.hr.get("/api/documents?q=memo");

    expect(titles(legal.body)).toEqual(["Legal Memo"]);
    expect(hr.body.total).toBe(0);
  });

  it("an admin's full list is not reused for an employee", async () => {
    const admin = await agents.admin.get("/api/documents?q=e");
    const hr = await agents.hr.get("/api/documents?q=e");

    expect(titles(admin.body)).toContain("Private Note");
    expect(titles(hr.body)).not.toContain("Private Note");
    expect(titles(hr.body)).not.toContain("Legal Memo");
  });

  it("moving a user to another department takes effect at once", async () => {
    const asLegal = await agents.legal.get("/api/documents?q=memo");
    expect(asLegal.body.total).toBe(1);

    await pool.query("UPDATE users SET department_id = $2 WHERE id = $1", [
      world.users.legal,
      world.departments.hr,
    ]);
    const asHr = await agents.legal.get("/api/documents?q=memo");

    expect(asHr.body.total).toBe(0);
  });
});

// Kept last: it closes the Redis connection for the rest of this file
describe("when Redis goes away", () => {
  it("search keeps working straight from PostgreSQL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cache.close();

    const res = await agents.hr.get("/api/documents?q=handbook");
    const health = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(["Handbook"]);
    expect(health.status).toBe(200);
    expect(health.body.cache).toBe("unavailable");

    vi.restoreAllMocks();
  });

  it("uploads keep working too", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Uploaded Without Redis" });

    expect(res.status).toBe(201);
  });
});
