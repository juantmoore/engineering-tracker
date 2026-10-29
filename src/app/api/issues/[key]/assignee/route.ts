import { apiRoute, readJson } from "@/lib/http";
import { assignIssue, TrackerError } from "@/lib/tracker";
import { AGENT_ACTOR } from "@/lib/users";

export const dynamic = "force-dynamic";

export const PUT = apiRoute(async (request: Request, ctx: RouteContext<"/api/issues/[key]/assignee">) => {
  const { key } = await ctx.params;
  const body = await readJson(request);
  if (!("accountId" in body)) throw new TrackerError(400, "accountId is required (a user id or null)");
  const { issue } = await assignIssue(key, body.accountId, AGENT_ACTOR);
  return Response.json(issue);
});
