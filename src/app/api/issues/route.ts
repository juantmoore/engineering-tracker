import { apiRoute } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => Response.json({ issues: await getStore().listIssues() }));
