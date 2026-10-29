import { apiRoute, readJson } from "@/lib/http";
import { transitionIssue } from "@/lib/tracker";
import { AGENT_ACTOR } from "@/lib/users";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request, ctx: RouteContext<"/api/issues/[key]/transitions">) => {
  const { key } = await ctx.params;
  const body = await readJson(request);
  const { issue } = await transitionIssue(key, body.status, AGENT_ACTOR);
  return Response.json(issue);
});
