import { createHash } from "node:crypto";
import type { PublicUser } from "../services/authService.js";
import * as cache from "./cache.js";

// Bumped on every upload. It is part of every key, so one INCR makes all
// older search results unreachable; Redis evicts them later.
const GENERATION_KEY = "search:generation";

export const SEARCH_TTL_SECONDS = 60;

// Search results depend on who is asking, not just on the filters:
// - admins see everything, so they can share one entry
// - everyone else sees public documents, their department's, and their own
//   uploads, so the key needs their department AND their user id
function viewerScope(user: PublicUser): string {
  return user.role === "admin" ? "admin" : `dept:${user.departmentId}:user:${user.id}`;
}

// null means "don't use the cache for this request" (Redis unavailable)
export async function keyFor(user: PublicUser, filters: unknown): Promise<string | null> {
  const generation = await cache.safely((redis) => redis.get(GENERATION_KEY));
  if (generation === undefined) return null;

  const filtersHash = createHash("sha256").update(JSON.stringify(filters)).digest("hex").slice(0, 32);
  return `search:${generation ?? "0"}:${viewerScope(user)}:${filtersHash}`;
}

export async function read<T>(key: string): Promise<T | null> {
  const raw = await cache.safely((redis) => redis.get(key));
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function write(key: string, value: unknown): Promise<void> {
  await cache.safely((redis) =>
    redis.set(key, JSON.stringify(value), { expiration: { type: "EX", value: SEARCH_TTL_SECONDS } }),
  );
}

// Call after any change that can alter search results
export async function invalidateAll(): Promise<void> {
  await cache.safely((redis) => redis.incr(GENERATION_KEY));
}
