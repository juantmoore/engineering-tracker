import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { trackerBaseUrl, webhookRetryDelays, webhookSecret, webhookTarget, WEBHOOK_TIMEOUT_MS } from "./config";
import { getStore } from "./store";
import { statusId, type ChangelogItem, type Delivery, type Issue, type IssueUpdatedEvent, type User } from "./types";

export function statusChange(from: Issue["status"], to: Issue["status"]): ChangelogItem {
  return { field: "status", fieldtype: "jira", from: statusId(from), fromString: from, to: statusId(to), toString: to };
}

export function assigneeChange(from: User | null, to: User | null): ChangelogItem {
  return {
    field: "assignee",
    fieldtype: "jira",
    from: from?.accountId ?? null,
    fromString: from?.displayName ?? null,
    to: to?.accountId ?? null,
    toString: to?.displayName ?? null,
  };
}

export function buildIssueUpdatedEvent(issue: Issue, user: User, items: ChangelogItem[]): IssueUpdatedEvent {
  return {
    webhookEvent: "jira:issue_updated",
    issue_event_type_name: "issue_generic",
    eventId: randomUUID(),
    timestamp: Date.now(),
    user: { accountId: user.accountId, displayName: user.displayName },
    issue: {
      id: issue.id,
      key: issue.key,
      self: `${trackerBaseUrl()}/api/issues/${issue.key}`,
      fields: {
        summary: issue.summary,
        status: { name: issue.status },
        assignee: issue.assignee ? { ...issue.assignee } : null,
        updated: issue.updated,
      },
    },
    changelog: { id: randomUUID(), items },
  };
}

export function describeChange(event: IssueUpdatedEvent): string {
  return event.changelog.items
    .map((i) => `${i.field}: ${i.fromString ?? "Unassigned"} to ${i.toString ?? "Unassigned"}`)
    .join("; ");
}

export interface DeliverOptions {
  url: string | null;
  secret: string | null;
  retryDelaysMs: number[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  record: (delivery: Delivery) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POSTs the event, retrying on non-2xx or network failure/timeout.
 * The body is serialized once so every attempt carries the same eventId.
 */
export async function deliverWebhook(event: IssueUpdatedEvent, opts: DeliverOptions): Promise<Delivery[]> {
  const maxAttempts = opts.retryDelaysMs.length + 1;
  const base = { eventId: event.eventId, issueKey: event.issue.key, change: describeChange(event), maxAttempts };
  const results: Delivery[] = [];
  const log = async (d: Omit<Delivery, keyof typeof base | "id" | "at">) => {
    const entry: Delivery = { id: randomUUID(), at: new Date().toISOString(), ...base, ...d };
    results.push(entry);
    await opts.record(entry);
  };

  const missing = !opts.url ? "AGENT_WEBHOOK_URL is not set" : !opts.secret ? "TRACKER_WEBHOOK_SECRET is not set" : null;
  if (missing) {
    await log({ attempt: 0, statusCode: null, ok: false, skipped: true, error: missing, durationMs: 0 });
    return results;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const body = JSON.stringify(event);
  const headers = {
    "Content-Type": "application/json",
    "X-Webhook-Secret": opts.secret!,
    "X-Atlassian-Webhook-Identifier": event.eventId,
    "User-Agent": "engineering-tracker-webhooks/1.0",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetchImpl(opts.url!, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs),
        cache: "no-store",
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error && e.name === "TimeoutError" ? `timeout after ${opts.timeoutMs}ms` : String(e);
    }
    const ok = error === null;
    await log({ attempt, statusCode, ok, skipped: false, error, durationMs: Date.now() - started });
    if (ok) break;
    if (attempt < maxAttempts) await sleep(opts.retryDelaysMs[attempt - 1]);
  }
  return results;
}

/**
 * Sends the webhook after the response is flushed when running inside a request
 * (Vercel keeps the function alive for `after`). Outside a request scope, such
 * as in tests or scripts, `after` throws and the delivery is awaited inline.
 */
export async function dispatchWebhook(event: IssueUpdatedEvent): Promise<void> {
  const store = getStore();
  const task = async () => {
    try {
      await deliverWebhook(event, {
        url: webhookTarget(),
        secret: webhookSecret(),
        retryDelaysMs: webhookRetryDelays(),
        timeoutMs: WEBHOOK_TIMEOUT_MS,
        record: (d) => store.addDelivery(d),
      });
    } catch (e) {
      console.error("webhook delivery failed to record", e);
    }
  };
  try {
    after(task);
  } catch {
    await task();
  }
}
