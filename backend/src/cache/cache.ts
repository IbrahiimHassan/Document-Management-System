import { createClient } from "redis";
import { env } from "../config/env.js";

type RedisClient = ReturnType<typeof createClient>;

// The cache only ever speeds things up. If Redis is missing or down, every
// helper here quietly returns undefined and callers fall back to PostgreSQL.
const client: RedisClient | null = env.REDIS_URL
  ? createClient({
      url: env.REDIS_URL,
      // Fail at once while disconnected instead of queueing commands until Redis returns
      disableOfflineQueue: true,
    })
  : null;

let warned = false;

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.error("Redis unavailable, continuing without the cache:", (error as Error)?.message ?? error);
}

client?.on("error", warnOnce);
client?.on("ready", () => {
  warned = false;
});

const connecting: Promise<unknown> = client ? client.connect().catch(warnOnce) : Promise.resolve();

export type CacheStatus = "connected" | "unavailable" | "disabled";

export function status(): CacheStatus {
  if (!client) return "disabled";
  return client.isReady ? "connected" : "unavailable";
}

// Resolves once the first connection attempt has finished (used at startup and in tests)
export async function ready(): Promise<void> {
  await connecting;
}

export async function safely<T>(run: (redis: RedisClient) => Promise<T>): Promise<T | undefined> {
  if (!client?.isReady) return undefined;
  try {
    return await run(client);
  } catch (error) {
    warnOnce(error);
    return undefined;
  }
}

export async function close(): Promise<void> {
  if (client?.isOpen) {
    await client.close();
  }
}
