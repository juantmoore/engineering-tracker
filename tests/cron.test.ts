import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/auto/route";
import { getStore } from "@/lib/store";
import { runAutoStep, setAutoMode } from "@/lib/tracker";
import type { Issue } from "@/lib/types";

const SECRET = "test-cron-secret-not-real";

function cronRequest(auth?: string) {
  return new Request("http://tracker.test/api/cron/auto", { headers: auth ? { authorization: auth } : {} });
}

function changedIssues(before: Issue[], after: Issue[]) {
  return after.filter((a) => before.find((b) => b.key === a.key)!.status !== a.status);
}

let webhooks: { user: { displayName: string }; issue: { key: string } }[];

beforeEach(async () => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("AGENT_WEBHOOK_URL", "http://receiver.test/jira/events");
  vi.stubEnv("TRACKER_WEBHOOK_SECRET", "test-secret-not-real");
  webhooks = [];
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    webhooks.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 202 });
  });
  await getStore().reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/cron/auto auth", () => {
  it("returns 401 without the header, with a wrong secret, or when CRON_SECRET is unset", async () => {
    await setAutoMode(true);
    expect((await cron(cronRequest())).status).toBe(401);
    expect((await cron(cronRequest("Bearer wrong"))).status).toBe(401);
    expect((await cron(cronRequest(SECRET))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron(cronRequest("Bearer "))).status).toBe(401);
    expect((await cron(cronRequest("Bearer undefined"))).status).toBe(401);
    expect(webhooks).toHaveLength(0);
  });
});

describe("auto mode", () => {
  it("is off by default and the cron run then changes nothing", async () => {
    const before = await getStore().listIssues();
    const res = await cron(cronRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, moved: null, skipped: expect.stringMatching(/off/i) });
    expect(await getStore().listIssues()).toEqual(before);
    expect(webhooks).toHaveLength(0);
  });

  it("moves exactly one ticket to a different status per run and fires one webhook", async () => {
    await setAutoMode(true);
    for (let run = 0; run < 10; run++) {
      const before = await getStore().listIssues();
      const res = await cron(cronRequest(`Bearer ${SECRET}`));
      expect(res.status).toBe(200);
      const { moved } = await res.json();
      const after = await getStore().listIssues();
      const changed = changedIssues(before, after);
      expect(changed).toHaveLength(1);
      expect(changed[0].key).toBe(moved.key);
      expect(moved.from).toBe(before.find((i) => i.key === moved.key)!.status);
      expect(moved.to).toBe(changed[0].status);
      expect(moved.to).not.toBe(moved.from);
    }
    expect(webhooks).toHaveLength(10);
    expect(new Set(webhooks.map((w) => w.user.displayName))).toEqual(new Set(["Auto mode"]));
  });

  it("uses the random source to pick the ticket and target status", async () => {
    const result = await runAutoStep({ force: true, rng: () => 0 });
    expect(result.moved).toEqual({ key: "WIT-10", from: "In Progress", to: "To Do" });
  });

  it("persists the toggle in the store", async () => {
    await setAutoMode(true);
    expect(await getStore().getSettings()).toEqual({ autoMode: true });
    await setAutoMode(false);
    expect(await getStore().getSettings()).toEqual({ autoMode: false });
  });
});

describe("vercel.json", () => {
  it("schedules the cron route every 5 minutes (needs a Pro or Enterprise team)", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    const jobs = config.crons.filter((c: { path: string }) => c.path === "/api/cron/auto");
    expect(jobs).toEqual([{ path: "/api/cron/auto", schedule: "*/5 * * * *" }]);
  });
});
