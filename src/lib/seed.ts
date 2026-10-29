import type { Issue, StatusName } from "./types";
import { findUser } from "./users";

interface SeedRow {
  n: number;
  summary: string;
  status: StatusName;
  assignee: string | null;
  comments: { author: string; body: string }[];
}

const ROWS: SeedRow[] = [
  {
    n: 10,
    summary: "Migrate session storage from Memcached to Redis",
    status: "In Progress",
    assignee: "u-sam",
    comments: [{ author: "Sam Lee", body: "Dual-write is live in staging. Watching hit rates before the cutover." }],
  },
  {
    n: 11,
    summary: "Fix flaky checkout integration test on CI",
    status: "To Do",
    assignee: null,
    comments: [],
  },
  {
    n: 12,
    summary: "Add rate limiting to the public search API",
    status: "In Review",
    assignee: "u-priya",
    comments: [{ author: "Priya Raman", body: "PR is up. Token bucket per API key, 100 req/min default." }],
  },
  {
    n: 13,
    summary: "Upgrade Postgres from 14 to 16 on the billing cluster",
    status: "Blocked",
    assignee: "u-diego",
    comments: [{ author: "Diego Alvarez", body: "Waiting on the DBA team for a maintenance window." }],
  },
  {
    n: 14,
    summary: "Instrument the payments service with OpenTelemetry traces",
    status: "To Do",
    assignee: "u-mei",
    comments: [],
  },
  {
    n: 15,
    summary: "Remove the legacy v1 webhooks endpoint",
    status: "Done",
    assignee: "u-sam",
    comments: [{ author: "Patrick Hughes", body: "Confirmed zero traffic for 30 days. Shipped." }],
  },
  {
    n: 16,
    summary: "Reduce Docker image size for the API service",
    status: "In Progress",
    assignee: "u-patrick",
    comments: [],
  },
  {
    n: 17,
    summary: "Alert on p95 latency regressions after deploys",
    status: "To Do",
    assignee: "u-priya",
    comments: [],
  },
];

export const SEED_KEYS = ROWS.map((r) => `WIT-${r.n}`);

export function seedIssues(now: Date = new Date()): Issue[] {
  return ROWS.map((row, i) => {
    const updated = new Date(now.getTime() - (ROWS.length - i) * 37 * 60_000);
    return {
      id: String(10_000 + row.n),
      key: `WIT-${row.n}`,
      summary: row.summary,
      status: row.status,
      assignee: row.assignee ? findUser(row.assignee)! : null,
      comments: row.comments.map((c, j) => ({
        id: `seed-${row.n}-${j + 1}`,
        body: c.body,
        author: c.author,
        created: new Date(updated.getTime() - 5 * 60_000).toISOString(),
      })),
      updated: updated.toISOString(),
    };
  });
}
