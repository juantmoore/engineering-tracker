import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import type { TrackerStore } from "./shared";

export type { TrackerStore } from "./shared";

function redisCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

const globalForStore = globalThis as unknown as { __trackerStore?: TrackerStore };

export function getStore(): TrackerStore {
  if (!globalForStore.__trackerStore) {
    const creds = process.env.TRACKER_STORE === "memory" ? null : redisCredentials();
    globalForStore.__trackerStore = creds ? new RedisStore(creds.url, creds.token) : new MemoryStore();
  }
  return globalForStore.__trackerStore;
}
