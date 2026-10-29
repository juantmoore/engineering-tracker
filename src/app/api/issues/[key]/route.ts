import { apiRoute } from "@/lib/http";
import { getIssue } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (_request: Request, ctx: RouteContext<"/api/issues/[key]">) => {
  const { key } = await ctx.params;
  return Response.json(await getIssue(key));
});
