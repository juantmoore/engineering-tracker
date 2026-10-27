import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function bearerMatches(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret}`);
}

/** Write-back API auth. Fails closed when TRACKER_API_KEY is not configured. */
export function isApiAuthorized(request: Request): boolean {
  return bearerMatches(request, process.env.TRACKER_API_KEY);
}