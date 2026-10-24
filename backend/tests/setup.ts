import { afterAll } from "vitest";
import * as cache from "../src/cache/cache.js";

// Refuse to run if the tests would hit anything but the test database
const url = process.env.DATABASE_URL ?? "";
if (!url.endsWith("_test")) {
  throw new Error(`Refusing to run tests: DATABASE_URL must end with "_test" (got "${url}")`);
}

// Close the Redis connection so each test file can exit cleanly
afterAll(async () => {
  await cache.close();
});
