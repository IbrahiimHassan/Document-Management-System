import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { insertDocument, loginAs, resetDb, seedWorld } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

const UNKNOWN_ID = "123e4567-e89b-42d3-a456-426614174000";

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "finance" | "legal" | "hr", Agent>;
let doc: string;

beforeAll(async () => {
  await resetDb();
  world = await seedWorld();
  agents = {
    admin: await loginAs("admin@example.com"),
    finance: await loginAs("finance@example.com"),
    legal: await loginAs("legal@example.com"),
    hr: await loginAs("hr@example.com"),
  };
});

// A fresh document for every test: public, uploaded by the Finance manager
beforeEach(async () => {
  doc = await insertDocument({
    title: "Budget Notes",
    description: "First draft",
    uploaderId: world.users.finance,
    tags: ["finance", "draft"],
  });
});

afterAll(async () => {
  await pool.end();
});

const edit = (agent: Agent, id: string, body: unknown) => agent.patch(`/api/documents/${id}`).send(body as object);

const titles = (body: { items: { title: string }[] }) => body.items.map((d) => d.title).sort();
// Every test makes its own "Budget Notes", so lists are checked by id
const ids = (body: { items: { id: string }[] }) => body.items.map((d) => d.id);

describe("PATCH /api/documents/:id: who may edit", () => {
  it("lets the uploader edit and returns the updated document", async () => {
    const res = await edit(agents.finance, doc, { title: "Budget Notes (final)", description: "Approved" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: doc, title: "Budget Notes (final)", description: "Approved" });
  });

  it("lets an admin edit someone else's document", async () => {
    const res = await edit(agents.admin, doc, { title: "Renamed by admin" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renamed by admin");
  });

  it("refuses a user who can see it but didn't upload it with 403", async () => {
    const res = await edit(agents.hr, doc, { title: "Hijacked" });

    expect(res.status).toBe(403);
    expect((await agents.hr.get(`/api/documents/${doc}`)).body.title).toBe("Budget Notes");
  });

  it("answers 404 for a document the user can't see, exactly like an unknown id", async () => {
    const hidden = await insertDocument({
      title: "Hidden",
      uploaderId: world.users.finance,
      visibility: "restricted",
      departmentIds: [world.departments.finance],
    });

    const hiddenRes = await edit(agents.hr, hidden, { title: "x" });
    const unknownRes = await edit(agents.hr, UNKNOWN_ID, { title: "x" });

    expect(hiddenRes.status).toBe(404);
    expect(hiddenRes.body).toEqual(unknownRes.body);
  });

  it("rejects a malformed id with 400 and a missing login with 401", async () => {
    expect((await edit(agents.admin, "not-a-uuid", { title: "x" })).status).toBe(400);
    expect((await request(app).patch(`/api/documents/${doc}`).send({ title: "x" })).status).toBe(401);
  });
});

describe("PATCH /api/documents/:id: validation", () => {
  it.each([
    ["an empty body", {}],
    ["an empty title", { title: "   " }],
    ["a title that is too long", { title: "x".repeat(201) }],
    ["tags that aren't a list", { tags: "finance" }],
    ["more than 10 tags", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["an unknown visibility", { visibility: "secret" }],
    ["a malformed department id", { visibility: "restricted", departmentIds: ["nope"] }],
    ["an unknown field", { titel: "typo" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await edit(agents.finance, doc, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects making it restricted without any department", async () => {
    const res = await edit(agents.finance, doc, { visibility: "restricted" });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at least one department/);
  });

  it("rejects a department that doesn't exist", async () => {
    const res = await edit(agents.finance, doc, { visibility: "restricted", departmentIds: [UNKNOWN_ID] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/do not exist/);
  });

  it("answers broken JSON with 400", async () => {
    const res = await agents.finance
      .patch(`/api/documents/${doc}`)
      .set("Content-Type", "application/json")
      .send('{"title": ');

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/documents/:id: what changes", () => {
  it("replaces the tags, normalised like on upload", async () => {
    const res = await edit(agents.finance, doc, { tags: [" Budget ", "FINANCE", "budget", ""] });

    expect(res.body.tags).toEqual(["budget", "finance"]);
  });

  it("clears the description with null", async () => {
    const res = await edit(agents.finance, doc, { description: null });

    expect(res.body.description).toBeNull();
  });

  it("leaves fields that weren't sent alone", async () => {
    const res = await edit(agents.finance, doc, { title: "Only the title" });

    expect(res.body).toMatchObject({ description: "First draft", tags: ["draft", "finance"], visibility: "public" });
  });

  it("restricting it hides it at once from other departments, even right after a cached search", async () => {
    // Warm the cache for HR first
    expect(ids((await agents.hr.get("/api/documents?limit=50")).body)).toContain(doc);

    const res = await edit(agents.finance, doc, {
      visibility: "restricted",
      departmentIds: [world.departments.finance, world.departments.legal],
    });
    expect(res.status).toBe(200);
    expect(res.body.allowedDepartments.map((d: { name: string }) => d.name)).toEqual(["Finance", "Legal"]);

    expect(ids((await agents.hr.get("/api/documents?limit=50")).body)).not.toContain(doc);
    expect((await agents.hr.get(`/api/documents/${doc}`)).status).toBe(404);
    expect((await agents.legal.get(`/api/documents/${doc}`)).status).toBe(200);
  });

  it("making it public again opens it to everyone and drops the department list", async () => {
    await edit(agents.finance, doc, { visibility: "restricted", departmentIds: [world.departments.finance] });

    const res = await edit(agents.finance, doc, { visibility: "public" });

    expect(res.body.visibility).toBe("public");
    expect(res.body.allowedDepartments).toEqual([]);
    const rows = await pool.query("SELECT 1 FROM document_permissions WHERE document_id = $1", [doc]);
    expect(rows.rowCount).toBe(0);
    expect((await agents.hr.get(`/api/documents/${doc}`)).status).toBe(200);
  });

  it("changing only the departments of a restricted document works", async () => {
    await edit(agents.finance, doc, { visibility: "restricted", departmentIds: [world.departments.finance] });

    await edit(agents.finance, doc, { departmentIds: [world.departments.hr] });

    expect((await agents.hr.get(`/api/documents/${doc}`)).status).toBe(200);
    expect((await agents.legal.get(`/api/documents/${doc}`)).status).toBe(404);
  });

  it("a renamed document is found by its new title straight away", async () => {
    expect((await agents.hr.get("/api/documents?q=Quarterly")).body.total).toBe(0);

    await edit(agents.finance, doc, { title: "Quarterly Plan" });

    expect(titles((await agents.hr.get("/api/documents?q=Quarterly")).body)).toEqual(["Quarterly Plan"]);
  });

  it("moves the document to the top of the list (updated now)", async () => {
    await insertDocument({ title: "Newer", uploaderId: world.users.finance });

    await edit(agents.finance, doc, { title: "Edited Later" });

    expect((await agents.finance.get("/api/documents")).body.items[0].title).toBe("Edited Later");
  });
});

describe("PATCH /api/documents/:id: audit", () => {
  async function editEvents() {
    const result = await pool.query<{ user_id: string; details: { changes: string[] } }>(
      "SELECT user_id, details FROM document_audit_events WHERE document_id = $1 AND action = 'edit'",
      [doc],
    );
    return result.rows;
  }

  it("records who edited and which fields changed", async () => {
    await edit(agents.admin, doc, {
      title: "New title",
      tags: ["finance", "draft"],
      visibility: "restricted",
      departmentIds: [world.departments.legal],
    });

    // The tags were sent but are the same, so they aren't listed
    expect(await editEvents()).toEqual([
      { user_id: world.users.admin, details: { changes: ["title", "visibility", "departments"] } },
    ]);
  });

  it("records nothing, and keeps the date, when nothing really changed", async () => {
    const before = (await agents.finance.get(`/api/documents/${doc}`)).body.updatedAt;

    const res = await edit(agents.finance, doc, { title: "Budget Notes", tags: ["DRAFT", "finance"] });

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(before);
    expect(await editEvents()).toEqual([]);
  });

  it("shows the edit in the document's activity", async () => {
    await edit(agents.finance, doc, { description: "Changed" });

    const res = await agents.finance.get(`/api/documents/${doc}/audit`);

    expect(res.body.items[0]).toMatchObject({
      action: "edit",
      userName: "Finance Manager",
      details: { changes: ["description"] },
    });
  });
});
