export const STATUSES = [
  { id: "to_do", name: "To Do" },
  { id: "in_progress", name: "In Progress" },
  { id: "in_review", name: "In Review" },
  { id: "blocked", name: "Blocked" },
  { id: "done", name: "Done" },
] as const;

export type StatusName = (typeof STATUSES)[number]["name"];
export type StatusId = (typeof STATUSES)[number]["id"];

export interface User {
  accountId: string;
  displayName: string;
}

export interface Comment {
  id: string;
  body: string;
  author: string;
  created: string;
}

export interface Issue {
  id: string;
  key: string;
  summary: string;
  status: StatusName;
  assignee: User | null;
  comments: Comment[];
  updated: string;
}

export interface ChangelogItem {
  field: "status" | "assignee";
  fieldtype: "jira";
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

export interface IssueUpdatedEvent {
  webhookEvent: "jira:issue_updated";
  issue_event_type_name: "issue_generic";
  eventId: string;
  timestamp: number;
  user: User;
  issue: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: { name: StatusName };
      assignee: User | null;
      updated: string;
    };
  };
  changelog: {
    id: string;
    items: ChangelogItem[];
  };
}

export interface Delivery {
  id: string;
  eventId: string;
  issueKey: string;
  change: string;
  attempt: number;
  maxAttempts: number;
  statusCode: number | null;
  ok: boolean;
  skipped: boolean;
  error: string | null;
  durationMs: number;
  at: string;
}

export interface Settings {
  autoMode: boolean;
}

export function statusByName(name: string) {
  const needle = name.trim().toLowerCase();
  return STATUSES.find(
    (s) => s.name.toLowerCase() === needle || s.id === needle.replace(/[\s-]+/g, "_"),
  );
}

export function statusId(name: StatusName): StatusId {
  return STATUSES.find((s) => s.name === name)!.id;
}
