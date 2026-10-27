import { randomUUID } from "node:crypto";
import { getStore } from "./store";
import { STATUSES, statusByName, type Comment, type Issue, type StatusName, type User } from "./types";
import { AUTO_ACTOR, findUser } from "./users";
import { assigneeChange, buildIssueUpdatedEvent, dispatchWebhook, statusChange } from "./webhook";

export class TrackerError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_COMMENT_AUTHOR = "workit-agent";

export interface IssueChange {
  issue: Issue;
  changed: boolean;
}

function normalizeKey(key: string): string {
  return decodeURIComponent(key).trim().toUpperCase();
}

async function loadIssue(key: string): Promise<Issue> {
  const issue = await getStore().getIssue(normalizeKey(key));
  if (!issue) throw new TrackerError(404, `Issue ${normalizeKey(key)} not found`);
  return issue;
}

/** Monotonic so two quick edits never share or reverse an `updated` value. */
function nextUpdated(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export async function getIssue(key: string): Promise<Issue> {
  return loadIssue(key);
}

// `actor` is who made the change; it becomes the webhook `user`.
export async function transitionIssue(key: string, status: unknown, actor: User): Promise<IssueChange> {
  const target = typeof status === "string" ? statusByName(status) : undefined;
  if (!target) {
    throw new TrackerError(400, `status must be one of: To Do, In Progress, In Review, Blocked, Done`);
  }
  const issue = await loadIssue(key);
  if (issue.status === target.name) return { issue, changed: false };

  const updated: Issue = { ...issue, status: target.name, updated: nextUpdated(issue.updated) };
  await getStore().putIssue(updated);
  await dispatchWebhook(buildIssueUpdatedEvent(updated, actor, [statusChange(issue.status, updated.status)]));
  return { issue: updated, changed: true };
}

export async function assignIssue(key: string, accountId: unknown, actor: User): Promise<IssueChange> {
  let assignee: User | null;
  if (accountId === null) {
    assignee = null;
  } else if (typeof accountId === "string") {
    const user = findUser(accountId);
    if (!user) throw new TrackerError(400, `Unknown accountId ${accountId}`);
    assignee = user;
  } else {
    throw new TrackerError(400, "accountId must be a string or null");
  }
  const issue = await loadIssue(key);
  if ((issue.assignee?.accountId ?? null) === (assignee?.accountId ?? null)) return { issue, changed: false };

  const updated: Issue = { ...issue, assignee, updated: nextUpdated(issue.updated) };
  await getStore().putIssue(updated);
  await dispatchWebhook(buildIssueUpdatedEvent(updated, actor, [assigneeChange(issue.assignee, updated.assignee)]));
  return { issue: updated, changed: true };
}

export async function addComment(key: string, body: unknown, author: unknown): Promise<Comment> {
  if (typeof body !== "string" || !body.trim()) throw new TrackerError(400, "body must be a non-empty string");
  if (author !== undefined && author !== null && typeof author !== "string") {
    throw new TrackerError(400, "author must be a string");
  }
  const issue = await loadIssue(key);
  const comment: Comment = {
    id: randomUUID(),
    body: body.trim(),
    author: (typeof author === "string" && author.trim()) || DEFAULT_COMMENT_AUTHOR,
    created: new Date().toISOString(),
  };
  await getStore().putIssue({ ...issue, comments: [...issue.comments, comment], updated: nextUpdated(issue.updated) });
  return comment;
}

export async function setAutoMode(on: boolean): Promise<void> {
  const store = getStore();
  await store.setSettings({ ...(await store.getSettings()), autoMode: on });
}

export interface AutoStepResult {
  moved: { key: string; from: StatusName; to: StatusName } | null;
  skipped?: string;
}

/** Moves one random ticket to a different random status. Skips when auto mode is off unless forced. */
export async function runAutoStep({ force = false, rng = Math.random } = {}): Promise<AutoStepResult> {
  const store = getStore();
  if (!force && !(await store.getSettings()).autoMode) return { moved: null, skipped: "Auto mode is off" };
  const issues = await store.listIssues();
  if (issues.length === 0) return { moved: null, skipped: "No issues" };
  const pick = issues[Math.floor(rng() * issues.length)];
  const options = STATUSES.filter((s) => s.name !== pick.status);
  const to = options[Math.floor(rng() * options.length)].name;
  await transitionIssue(pick.key, to, AUTO_ACTOR);
  return { moved: { key: pick.key, from: pick.status, to } };
}
