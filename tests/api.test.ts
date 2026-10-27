import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listIssues } from "@/app/api/issues/route";
import { GET as getIssue } from "@/app/api/issues/[key]/route";
import { POST as postComment } from "@/app/api/issues/[key]/comments/route";
import { PUT as putAssignee } from "@/app/api/issues/[key]/assignee/route";
import { POST as postTransition } from "@/app/api/issues/[key]/transitions/route";
import { GET as listUsers } from "@/app/api/users/route";
import { getStore } from "@/lib/store";

const KEY = "test-api-key-not-real";
const BASE = "http://tracker.test";

type Handler = (req: Request, ctx: { params: Promise<{ key: string }> }) => Promise<Response>;

function call(handler: Handler, method: string, path: string, opts: { auth?: string | null; body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = opts.auth === undefined ? `Bearer ${KEY}` : opts.auth;
  if (auth !== null) headers.authorization = auth;
  const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const req = new Request(`${BASE}${path}`, { method, headers, body });
  return handler(req, { params: Promise.resolve({ key: opts.key ?? "" }) });
}

const ISSUE_KEYS = ["assignee", "comments", "id", "key", "status", "summary", "updated"];

let webhookBodies: { user: unknown; changelog: { items: { field: string }[] } }[];

beforeEach(async () => {
  vi.stubEnv("TRACKER_API_KEY", KEY);
  vi.stubEnv("AGENT_WEBHOOK_URL", "http://receiver.test/jira/events");
  vi.stubEnv("TRACKER_WEBHOOK_SECRET", "test-secret-not-real");
  vi.stubEnv("WEBHOOK_RETRY_DELAYS_MS", "0,0");
  webhookBodies = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    webhookBodies.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 202 });
  });
  await getStore().reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("auth", () => {
  const endpoints: [string, Handler, string, string, unknown?][] = [
    ["GET /api/issues", listIssues as Handler, "GET", "/api/issues"],
    ["GET /api/issues/{key}", getIssue, "GET", "/api/issues/WIT-12"],
    ["POST comments", postComment, "POST", "/api/issues/WIT-12/comments", { body: "hi" }],
    ["PUT assignee", putAssignee, "PUT", "/api/issues/WIT-12/assignee", { accountId: "u-sam" }],
    ["POST transitions", postTransition, "POST", "/api/issues/WIT-12/transitions", { status: "Done" }],
    ["GET /api/users", listUsers as Handler, "GET", "/api/users"],
  ];

  it.each(endpoints)("%s returns 401 without a key, with a bad key and with a non-Bearer scheme", async (_n, h, method, path, body) => {
    for (const auth of [null, "Bearer wrong-key", `Basic ${KEY}`, KEY, "Bearer "]) {
      const res = await call(h, method, path, { auth, body, key: "WIT-12" });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("fails closed when TRACKER_API_KEY is not configured", async () => {
    vi.stubEnv("TRACKER_API_KEY", "");
    expect((await call(listIssues as Handler, "GET", "/api/issues", { auth: "Bearer " })).status).toBe(401);
    expect((await call(listIssues as Handler, "GET", "/api/issues", { auth: "Bearer undefined" })).status).toBe(401);
  });

  it("rejected writes change nothing and fire no webhook", async () => {
    await call(postTransition, "POST", "/api/issues/WIT-12/transitions", { auth: "Bearer nope", body: { status: "Done" }, key: "WIT-12" });
    expect((await getStore().getIssue("WIT-12"))!.status).toBe("In Review");
    expect(webhookBodies).toHaveLength(0);
  });
});

describe("reads", () => {
  it("GET /api/issues lists every issue in the contract shape", async () => {
    const res = await call(listIssues as Handler, "GET", "/api/issues");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const { issues } = await res.json();
    expect(issues).toHaveLength(8);
    for (const issue of issues) expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
  });

  it("GET /api/issues/{key} returns the issue or 404", async () => {
    const res = await call(getIssue, "GET", "/api/issues/WIT-12", { key: "WIT-12" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "10012", key: "WIT-12", status: "In Review", assignee: { accountId: "u-priya" } });
    const missing = await call(getIssue, "GET", "/api/issues/WIT-99", { key: "WIT-99" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: expect.stringContaining("WIT-99") });
  });

  it("GET /api/users lists assignable users", async () => {
    const { users } = await (await call(listUsers as Handler, "GET", "/api/users")).json();
    expect(users).toContainEqual({ accountId: "u-sam", displayName: "Sam Lee" });
    for (const u of users) expect(Object.keys(u).sort()).toEqual(["accountId", "displayName"]);
  });
});

describe("POST /api/issues/{key}/comments", () => {
  it("returns 201 with the Comment and persists it", async () => {
    const res = await call(postComment, "POST", "/api/issues/WIT-12/comments", {
      key: "WIT-12",
      body: { body: "Rate limiter looks good, approving.", author: "workit-agent" },
    });
    expect(res.status).toBe(201);
    const comment = await res.json();
    expect(Object.keys(comment).sort()).toEqual(["author", "body", "created", "id"]);
    expect(comment).toMatchObject({ body: "Rate limiter looks good, approving.", author: "workit-agent" });
    expect((await getStore().getIssue("WIT-12"))!.comments.at(-1)).toEqual(comment);
  });

  it("returns 400 for a missing body or invalid JSON and 404 for unknown issues", async () => {
    expect((await call(postComment, "POST", "/x", { key: "WIT-12", body: { author: "a" } })).status).toBe(400);
    expect((await call(postComment, "POST", "/x", { key: "WIT-12", body: "{not json" })).status).toBe(400);
    expect((await call(postComment, "POST", "/x", { key: "WIT-99", body: { body: "hi" } })).status).toBe(404);
  });
});

describe("PUT /api/issues/{key}/assignee", () => {
  it("assigns, unassigns and fires the webhook as the agent", async () => {
    const res = await call(putAssignee, "PUT", "/api/issues/WIT-12/assignee", { key: "WIT-12", body: { accountId: "u-sam" } });
    expect(res.status).toBe(200);
    const issue = await res.json();
    expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    expect(issue.assignee).toEqual({ accountId: "u-sam", displayName: "Sam Lee" });

    const cleared = await (await call(putAssignee, "PUT", "/x", { key: "WIT-12", body: { accountId: null } })).json();
    expect(cleared.assignee).toBeNull();

    expect(webhookBodies).toHaveLength(2);
    expect(webhookBodies[0].user).toEqual({ accountId: "workit-agent", displayName: "WorkIt Agent" });
    expect(webhookBodies[0].changelog.items[0].field).toBe("assignee");
  });

  it("returns 400 for unknown users or a missing accountId", async () => {
    expect((await call(putAssignee, "PUT", "/x", { key: "WIT-12", body: { accountId: "u-ghost" } })).status).toBe(400);
    expect((await call(putAssignee, "PUT", "/x", { key: "WIT-12", body: {} })).status).toBe(400);
    expect((await call(putAssignee, "PUT", "/x", { key: "WIT-99", body: { accountId: "u-sam" } })).status).toBe(404);
  });
});

describe("POST /api/issues/{key}/transitions", () => {
  it("moves the issue and fires one webhook as the agent", async () => {
    const res = await call(postTransition, "POST", "/api/issues/WIT-12/transitions", { key: "WIT-12", body: { status: "Done" } });
    expect(res.status).toBe(200);
    const issue = await res.json();
    expect(issue.status).toBe("Done");
    expect((await getStore().getIssue("WIT-12"))!.status).toBe("Done");
    expect(webhookBodies).toHaveLength(1);
    expect(webhookBodies[0].user).toEqual({ accountId: "workit-agent", displayName: "WorkIt Agent" });
    expect(webhookBodies[0].changelog.items[0].field).toBe("status");
  });

  it("returns 400 for an unknown status", async () => {
    const res = await call(postTransition, "POST", "/x", { key: "WIT-12", body: { status: "Shipped" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("In Review") });
  });
});
