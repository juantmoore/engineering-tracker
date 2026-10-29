import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store/memory";
import { RedisStore } from "@/lib/store/redis";
import type { TrackerStore } from "@/lib/store";
import type { Delivery } from "@/lib/types";

function delivery(n: number): Delivery {
  return {
    id: `d-${n}`,
    eventId: `e-${n}`,
    issueKey: "WIT-10",
    change: "status: To Do to In Progress",
    attempt: 1,
    maxAttempts: 3,
    statusCode: 202,
    ok: true,
    skipped: false,
    error: null,
    durationMs: 5,
    at: new Date().toISOString(),
  };
}

const redisUrl = process.env.TEST_REDIS_REST_URL;
const redisToken = process.env.TEST_REDIS_REST_TOKEN ?? "";

const backends: [string, () => TrackerStore][] = [["memory", () => new MemoryStore()]];
if (redisUrl) backends.push(["redis", () => new RedisStore(redisUrl, redisToken)]);

describe.each(backends)("%s store", (_name, make) => {
  let store: TrackerStore;

  beforeEach(async () => {
    store = make();
    await store.reset();
  });

  it("seeds 8 WIT tickets in key order with Jira-style numeric ids", async () => {
    const issues = await store.listIssues();
    expect(issues.map((i) => i.key)).toEqual([
      "WIT-10", "WIT-11", "WIT-12", "WIT-13", "WIT-14", "WIT-15", "WIT-16", "WIT-17",
    ]);
    expect(issues.find((i) => i.key === "WIT-12")!.id).toBe("10012");
    const statuses = new Set(issues.map((i) => i.status));
    expect(statuses).toEqual(new Set(["To Do", "In Progress", "In Review", "Blocked", "Done"]));
    expect(issues.some((i) => i.assignee === null)).toBe(true);
  });

  it("persists issue updates and returns null for unknown keys", async () => {
    const issue = (await store.getIssue("WIT-11"))!;
    await store.putIssue({ ...issue, status: "Done" });
    expect((await store.getIssue("WIT-11"))!.status).toBe("Done");
    expect((await store.listIssues()).find((i) => i.key === "WIT-11")!.status).toBe("Done");
    expect(await store.getIssue("WIT-999")).toBeNull();
  });

  it("keeps the newest deliveries first, capped at 50", async () => {
    for (let n = 1; n <= 55; n++) await store.addDelivery(delivery(n));
    const log = await store.listDeliveries();
    expect(log).toHaveLength(50);
    expect(log[0].eventId).toBe("e-55");
    expect((await store.listDeliveries(3)).map((d) => d.eventId)).toEqual(["e-55", "e-54", "e-53"]);
  });

  it("stores the auto mode toggle, off by default", async () => {
    expect(await store.getSettings()).toEqual({ autoMode: false });
    await store.setSettings({ autoMode: true });
    expect(await store.getSettings()).toEqual({ autoMode: true });
  });

  it("reset restores the seed, clears deliveries and turns auto mode off", async () => {
    const issue = (await store.getIssue("WIT-10"))!;
    await store.putIssue({ ...issue, status: "Blocked", assignee: null });
    await store.addDelivery(delivery(1));
    await store.setSettings({ autoMode: true });

    await store.reset();

    const restored = (await store.getIssue("WIT-10"))!;
    expect(restored.status).toBe("In Progress");
    expect(restored.assignee?.accountId).toBe("u-sam");
    expect(await store.listDeliveries()).toEqual([]);
    expect(await store.getSettings()).toEqual({ autoMode: false });
  });
});
