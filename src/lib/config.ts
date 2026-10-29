export function trackerBaseUrl(): string {
  const explicit = process.env.TRACKER_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function webhookTarget(): string | null {
  return process.env.AGENT_WEBHOOK_URL || null;
}

export function webhookSecret(): string | null {
  return process.env.TRACKER_WEBHOOK_SECRET || null;
}

export const WEBHOOK_TIMEOUT_MS = 5_000;

/** Delays before attempt 2, 3, ... Override with WEBHOOK_RETRY_DELAYS_MS="500,2000". */
export function webhookRetryDelays(): number[] {
  const raw = process.env.WEBHOOK_RETRY_DELAYS_MS;
  if (!raw) return [500, 2_000];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}
