import { readFile } from "node:fs/promises";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { openApiSpec } from "../src/docs/openapi.js";

afterAll(async () => {
  await pool.end();
});

describe("API docs at /api/docs", () => {
  it("serves the Swagger page without a login", async () => {
    const res = await request(app).get("/api/docs");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="swagger-ui"></div>');
  });

  it("uses no inline script, and a CSP that works over plain http", async () => {
    const res = await request(app).get("/api/docs");
    const csp = res.headers["content-security-policy"];

    expect(res.text).not.toMatch(/<script>(?!<\/script>)/);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("serves the Swagger UI files from the package, not a CDN", async () => {
    const js = await request(app).get("/api/docs/assets/swagger-ui-bundle.js");
    const css = await request(app).get("/api/docs/assets/swagger-ui.css");
    const init = await request(app).get("/api/docs/init.js");

    expect(js.status).toBe(200);
    expect(css.status).toBe(200);
    expect(init.text).toContain("/api/docs/openapi.json");
  });

  it("serves the OpenAPI document", async () => {
    const res = await request(app).get("/api/docs/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
  });
});

describe("the OpenAPI document covers the whole API", () => {
  // Read the route files themselves, so a new route without docs fails this test
  const mounts: Record<string, string> = {
    "authRoutes.ts": "/api/auth",
    "documentRoutes.ts": "/api/documents",
    "departmentRoutes.ts": "/api/departments",
  };

  async function routesInCode(): Promise<string[]> {
    const routes: string[] = ["get /api/health"];
    for (const [file, prefix] of Object.entries(mounts)) {
      const source = await readFile(new URL(`../src/routes/${file}`, import.meta.url), "utf8");
      for (const [, method, path] of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
        const full = `${prefix}${path === "/" ? "" : path}`.replace(/:(\w+)/g, "{$1}");
        routes.push(`${method} ${full}`);
      }
    }
    return routes.sort();
  }

  it("finds the routes in the code (so the next test means something)", async () => {
    expect((await routesInCode()).length).toBeGreaterThanOrEqual(20);
  });

  it("documents every route", async () => {
    const paths = openApiSpec.paths as Record<string, Record<string, unknown>>;
    const documented = Object.entries(paths)
      .flatMap(([path, item]) =>
        Object.keys(item)
          .filter((key) => ["get", "post", "put", "patch", "delete"].includes(key))
          .map((method) => `${method} ${path}`),
      )
      .sort();

    expect(documented).toEqual(await routesInCode());
  });
});
