import { isApiAuthorized } from "./auth";
import { TrackerError } from "./tracker";

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new TrackerError(400, "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TrackerError(400, "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** Bearer TRACKER_API_KEY auth plus contract-style `{ error }` responses. */
export function apiRoute<C>(handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    if (!isApiAuthorized(request)) return jsonError(401, "Missing or invalid API key");
    try {
      return await handler(request, ctx);
    } catch (e) {
      if (e instanceof TrackerError) return jsonError(e.status, e.message);
      console.error(e);
      return jsonError(500, "Internal error");
    }
  };
}
