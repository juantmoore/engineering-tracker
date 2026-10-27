import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStore } from "@/lib/store";
import { addComment, assignIssue, transitionIssue } from "@/lib/tracker";
import { assigneeChange, buildIssueUpdatedEvent, deliverWebhook, statusChange } from "@/lib/webhook";
import type { Delivery, IssueUpdatedEvent } from "@/lib/types";
import { UI_ACTOR } from "@/lib/users";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const URL_ = "http://receiver.test/jira/events";
const SECRET = "test-secret-not-real";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: IssueUpdatedEvent;
  raw: string;
}

/** Fake agent endpoint: answers with the given statuses in order (then 202), or throws for "network". */
function fakeAgent(responses: (number | "network")[] = []) {
  const calls: Captured[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const raw = String(init?.body);
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(raw),
      raw,
    });
    const next = responses.shift() ?? 202;
    if (next === "network") throw new TypeError("fetch failed");
    return new Response(null, { status: next });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function sampleEvent() {
  const issue = (await getStore().getIssue("WIT-12"))!;
  return buildIssueUpdatedEvent(issue, UI_ACTOR, [statusChange("In Progress", "In Review")]);
}

function opts(fetchImpl: typeof fetch, recorded: Delivery[] = []) {
  return {
    url: URL_,
    secret: SECRET,
    retryDelaysMs: [0, 0],
    timeoutMs: 1000,
    fetchImpl,
    record: async (d: Delivery) => void recorded.push(d),
  };
}

beforeEach(async () => {
  await getStore().reset();
});

describe("webhook payload", () => {
  it("matches the Jira jira:issue_updated shape from the contract", async () => {
    process.env.TRACKER_BASE_URL = "https://tracker.example.com";
    const event = await sampleEvent();
    delete process.env.TRACKER_BASE_URL;

    expect(Object.keys(event).sort()).toEqual(
      ["changelog", "eventId", "issue", "issue_event_type_name", "timestamp", "user", "webhookEvent"].sort(),
    );
    expect(event.webhookEvent).toBe("jira:issue_updated");
    expect(event.issue_event_type_name).toBe("issue_generic");
    expect(event.eventId).toMatch(UUID);
    expect(typeof event.timestamp).toBe("number");
    expect(event.user).toEqual({ accountId: "u-patrick", displayName: "Patrick Hughes" });
    expect(event.issue).toEqual({
      id: "10012",
      key: "WIT-12",
      self: "https://tracker.example.com/api/issues/WIT-12",
      fields: {
        summary: "Add rate limiting to the public search API",
        status: { name: "In Review" },
        assignee: { accountId: "u-priya", displayName: "Priya Raman" },
        updated: expect.any(String),
      },
    });
    expect(event.changelog.id).toMatch(UUID);
    expect(event.changelog.items).toEqual([
      { field: "status", fieldtype: "jira", from: "in_progress", fromString: "In Progress", to: "in_review", toString: "In Review" },
    ]);
  });

  it("describes assignee changes with accountIds and allows null", () => {
    expect(assigneeChange(null, { accountId: "u-sam", displayName: "Sam Lee" })).toEqual({
      field: "assignee", fieldtype: "jira", from: null, fromString: null, to: "u-sam", toString: "Sam Lee",
    });
    expect(assigneeChange({ accountId: "u-sam", displayName: "Sam Lee" }, null)).toMatchObject({ to: null, toString: null });
  });
});

describe("deliverWebhook", () => {
  it("POSTs JSON with the secret and the Atlassian identifier header equal to eventId", async () => {
    const agent = fakeAgent();
    const event = await sampleEvent();
    const log: Delivery[] = [];
    await deliverWebhook(event, opts(agent.fetchImpl, log));

    expect(agent.calls).toHaveLength(1);
    const [call] = agent.calls;
    expect(call.url).toBe(URL_);
    expect(call.method).toBe("POST");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["x-webhook-secret"]).toBe(SECRET);
    expect(call.headers["x-atlassian-webhook-identifier"]).toBe(event.eventId);
    expect(call.body).toEqual(event);
    expect(log).toMatchObject([{ eventId: event.eventId, issueKey: "WIT-12", attempt: 1, statusCode: 202, ok: true }]);
  });

  it("retries non-2xx and network failures with the same eventId and identical body", async () => {
    const agent = fakeAgent([500, "network", 202]);
    const event = await sampleEvent();
    const log: Delivery[] = [];
    await deliverWebhook(event, opts(agent.fetchImpl, log));

    expect(agent.calls).toHaveLength(3);
    expect(new Set(agent.calls.map((c) => c.body.eventId))).toEqual(new Set([event.eventId]));
    expect(new Set(agent.calls.map((c) => c.headers["x-atlassian-webhook-identifier"]))).toEqual(new Set([event.eventId]));
    expect(new Set(agent.calls.map((c) => c.raw)).size).toBe(1);
    expect(log.map((d) => [d.attempt, d.statusCode, d.ok])).toEqual([
      [1, 500, false],
      [2, null, false],
      [3, 202, true],
    ]);
  });

  it("treats a timeout as a failed attempt and retries", async () => {
    let n = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (n++ === 0) {
        await new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        );
      }
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const log: Delivery[] = [];
    await deliverWebhook(await sampleEvent(), { ...opts(fetchImpl, log), timeoutMs: 50 });
    expect(log.map((d) => d.ok)).toEqual([false, true]);
    expect(log[0].error).toMatch(/timeout/);
  });

  it("stops after 3 attempts when the agent keeps failing", async () => {
    const agent = fakeAgent([503, 503, 503, 503]);
    const log: Delivery[] = [];
    await deliverWebhook(await sampleEvent(), opts(agent.fetchImpl, log));
    expect(agent.calls).toHaveLength(3);
    expect(log.every((d) => !d.ok && d.maxAttempts === 3)).toBe(true);
  });

  it("records a skipped delivery when AGENT_WEBHOOK_URL is not set", async () => {
    const agent = fakeAgent();
    const log: Delivery[] = [];
    await deliverWebhook(await sampleEvent(), { ...opts(agent.fetchImpl, log), url: null });
    expect(agent.calls).toHaveLength(0);
    expect(log).toMatchObject([{ skipped: true, ok: false, error: "AGENT_WEBHOOK_URL is not set" }]);
  });
});

describe("tracker changes fire webhooks", () => {
  let agent: ReturnType<typeof fakeAgent>;

  beforeEach(() => {
    agent = fakeAgent();
    vi.stubGlobal("fetch", agent.fetchImpl);
    vi.stubEnv("AGENT_WEBHOOK_URL", URL_);
    vi.stubEnv("TRACKER_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("WEBHOOK_RETRY_DELAYS_MS", "0,0");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("a status change fires exactly one webhook and logs the delivery", async () => {
    await transitionIssue("WIT-11", "In Progress", UI_ACTOR);
    expect(agent.calls).toHaveLength(1);
    const { body } = agent.calls[0];
    expect(body.issue.key).toBe("WIT-11");
    expect(body.issue.fields.status).toEqual({ name: "In Progress" });
    expect(body.user).toEqual(UI_ACTOR);
    expect(body.changelog.items).toEqual([statusChange("To Do", "In Progress")]);
    const log = await getStore().listDeliveries();
    expect(log).toMatchObject([{ eventId: body.eventId, issueKey: "WIT-11", statusCode: 202, ok: true }]);
  });

  it("an assignee change fires one webhook with field assignee", async () => {
    await assignIssue("WIT-12", null, UI_ACTOR);
    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0].body.issue.fields.assignee).toBeNull();
    expect(agent.calls[0].body.changelog.items).toEqual([
      { field: "assignee", fieldtype: "jira", from: "u-priya", fromString: "Priya Raman", to: null, toString: null },
    ]);
  });

  it("each event gets a unique eventId", async () => {
    await transitionIssue("WIT-11", "In Progress", UI_ACTOR);
    await transitionIssue("WIT-11", "Done", UI_ACTOR);
    await assignIssue("WIT-11", "u-sam", UI_ACTOR);
    const ids = agent.calls.map((c) => c.body.eventId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("no-op changes and comments do not fire webhooks", async () => {
    await transitionIssue("WIT-11", "To Do", UI_ACTOR);
    await assignIssue("WIT-11", null, UI_ACTOR);
    await addComment("WIT-11", "just a comment", "Patrick Hughes");
    expect(agent.calls).toHaveLength(0);
  });
});
