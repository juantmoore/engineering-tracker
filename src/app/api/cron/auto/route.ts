import { isCronAuthorized } from "@/lib/auth";
import { runAutoStep } from "@/lib/tracker";

export const dynamic = "force-dynamic";

/** Invoked by Vercel Cron (see vercel.json). Moves one random ticket when auto mode is on. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runAutoStep();
  return Response.json({ ok: true, moved: result.moved, ...(result.skipped ? { skipped: result.skipped } : {}) });
}
