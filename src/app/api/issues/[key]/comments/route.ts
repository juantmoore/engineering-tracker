import { apiRoute, readJson } from "@/lib/http";
import { addComment } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request, ctx: RouteContext<"/api/issues/[key]/comments">) => {
  const { key } = await ctx.params;
  const body = await readJson(request);
  return Response.json(await addComment(key, body.body, body.author), { status: 201 });
});
