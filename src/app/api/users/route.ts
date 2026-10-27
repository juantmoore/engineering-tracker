import { apiRoute } from "@/lib/http";
import { USERS } from "@/lib/users";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => Response.json({ users: USERS }));
