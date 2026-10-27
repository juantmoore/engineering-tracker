# Engineering Tracker

A small Jira-style ticket board used as a stand-in for Jira in client demos. It is a standalone
Next.js (App Router, TypeScript) app that deploys as its own Vercel project.

A separate eve agent (in another repo) receives this app's webhooks and calls its write-back API.
[`docs/contract.md`](docs/contract.md) is the only interface between the two. This app implements it as written.

- Board with To Do, In Progress, In Review, Blocked and Done. Eight seeded tickets, WIT-10 to WIT-17.
- Change status by dragging a card or with the select in the ticket panel. Change the assignee. Read and add comments.
- Every status or assignee change, from the UI, the API or auto mode, POSTs a Jira-style
  `jira:issue_updated` webhook to `AGENT_WEBHOOK_URL`. Failed deliveries retry with the same `eventId`.
- Recent deliveries log on the board (ticket, change, eventId, attempt, HTTP status).
- Auto mode: a Vercel Cron job moves one random ticket per run while the toggle is on.
- Write-back API with `Authorization: Bearer TRACKER_API_KEY`.
- Upstash Redis storage on Vercel, with an in-memory fallback for local dev and tests. "Reset to seed" restores the demo data.

## Environment variables

Copy `.env.example` to `.env.local` for local dev. Set the same names in Vercel for deployments.
Generate secrets with `openssl rand -hex 32`. Never commit real values.

| Variable | Required | What it is | Must match the agent project? |
| --- | --- | --- | --- |
| `AGENT_WEBHOOK_URL` | Yes | Full webhook URL, `{AGENT_BASE_URL}/jira/events` | Yes, it is the agent's production URL plus `/jira/events` |
| `TRACKER_WEBHOOK_SECRET` | Yes | Sent as `X-Webhook-Secret` on every webhook | Yes, same value as the agent's `TRACKER_WEBHOOK_SECRET` |
| `TRACKER_API_KEY` | Yes | Bearer key for the write-back API | Yes, same value as the agent's `TRACKER_API_KEY` |
| `CRON_SECRET` | Yes | Vercel Cron sends it as `Authorization: Bearer ...` | No, this project only |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | On Vercel | Upstash Redis REST credentials, added by the Marketplace integration | No |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Alternative | Same as above, the names Upstash uses for linked accounts | No |
| `TRACKER_BASE_URL` | Optional | Public URL of this app, used for `issue.self`. Defaults to the Vercel production domain | If set, same value as the agent's `TRACKER_BASE_URL` |
| `TRACKER_STORE` | Optional | `memory` forces the in-memory store | No |
| `WEBHOOK_RETRY_DELAYS_MS` | Optional | Delays before retry attempts, default `500,2000` (3 attempts total) | No |

Missing secrets fail closed: without `TRACKER_API_KEY` every API call returns 401, without `CRON_SECRET`
the cron route returns 401, and without `AGENT_WEBHOOK_URL` or `TRACKER_WEBHOOK_SECRET` webhooks are
logged as "Skipped" instead of being sent.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in values, or leave Redis vars empty for the in-memory store
npm run dev                  # http://localhost:3000
```

Useful scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify`.

Try the API (replace the key with the one in your `.env.local`):

```bash
KEY=your-local-api-key
curl -s localhost:3000/api/issues -H "Authorization: Bearer $KEY"
curl -s -X POST localhost:3000/api/issues/WIT-12/transitions -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"status":"Done"}'
curl -s -X PUT localhost:3000/api/issues/WIT-12/assignee -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"accountId":"u-sam"}'
curl -s -X POST localhost:3000/api/issues/WIT-12/comments -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"body":"Looks good","author":"workit-agent"}'
```

## Deploy on Vercel

1. In Vercel, **Add New > Project**, import this GitHub repo. The Next.js preset needs no changes.
2. Open the project's **Storage** tab, pick **Upstash for Redis** from the Marketplace, create a database
   (the free plan is enough) and connect it to this project for Production, Preview and Development.
   This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. In **Settings > Environment Variables**, add `AGENT_WEBHOOK_URL`, `TRACKER_WEBHOOK_SECRET`,
   `TRACKER_API_KEY` and `CRON_SECRET` (see the table above for which values must match the agent).
4. Redeploy so the new variables apply. The header badge should say "Upstash Redis", not "In-memory store".
5. In the agent project, set `TRACKER_BASE_URL` to this project's production URL, and set the shared
   `TRACKER_WEBHOOK_SECRET` and `TRACKER_API_KEY`. Point `AGENT_WEBHOOK_URL` here at the agent's production URL.

Vercel's default Deployment Protection puts preview URLs behind Vercel login, so use production
domains on both sides for agent traffic. Preview and production share the same Redis database when
the store is connected to both, so a preview deployment edits the same board.

## Auto mode and the cron schedule

`vercel.json` schedules `GET /api/cron/auto` at `0 15 * * *`, once a day at 15:00 UTC. Vercel's Hobby plan
only allows cron jobs that run at most once per day (and may fire any time within that hour), and more
frequent schedules fail the deployment. A daily schedule deploys on every plan.

On a Pro or Enterprise plan you can run it as often as once per minute. For a livelier demo, change the
schedule to `*/5 * * * *` (every 5 minutes) and redeploy.

Each run checks `Authorization: Bearer $CRON_SECRET` (Vercel adds this header automatically when
`CRON_SECRET` is set), then, if the auto mode toggle is on, moves exactly one random ticket to a
different status and fires the webhook with `user` set to "Auto mode". When the toggle is off the run
does nothing. The toggle is stored in Redis.

To see it during a demo without waiting for the schedule, use **Move a random ticket** in the header
(runs the same step immediately), use **Run** on the job in the project's **Settings > Cron Jobs**, or call it yourself:

```bash
curl -s https://your-tracker.vercel.app/api/cron/auto -H "Authorization: Bearer $CRON_SECRET"
```

## Webhooks

Status and assignee changes send `POST AGENT_WEBHOOK_URL` with `Content-Type: application/json`,
`X-Webhook-Secret` and `X-Atlassian-Webhook-Identifier: {eventId}`. The body follows Jira Cloud's
`jira:issue_updated` webhook, see `docs/contract.md`. Changes that set the same value again, and new
comments, send nothing.

Delivery runs after the response is sent (`after()` from `next/server`), with a 5 second timeout per
attempt. A non-2xx response, network error or timeout is retried twice more with the identical body
and `eventId`, so the agent can dedupe on `eventId`. Every attempt appears in the deliveries log.

## Verification

`scripts/verify.sh` (also `npm run verify`) checks the real app end to end and prints PASS or FAIL per check:

1. Lint, typecheck and the Vitest suite, then `next build`.
2. Starts the production server, a local webhook receiver (`scripts/receiver.mjs`) and, when
   `redis-server` is installed, a real Redis behind an Upstash REST shim (`scripts/upstash-rest-shim.mjs`).
3. Store suite against real Redis through `@upstash/redis`.
4. Headless Chrome (`scripts/ui-check.mjs`): board loads the seeded tickets, status changes by select and by
   drag persist across reloads, exactly one webhook per change with the right body and headers, retries
   reuse the `eventId` (the receiver fails twice with 503 on purpose), comments persist and send no webhook,
   and the deliveries log shows it all.
5. curl against every API endpoint: 401 with no key and a bad key, then the happy paths, 400 and 404.
6. Cron: 401 without or with a wrong `CRON_SECRET`, no change while auto mode is off, then three runs
   that each move exactly one ticket and fire one webhook.

Secrets are random fake values generated per run. Screenshots, captured webhooks and the curl transcript
go to `artifacts/` (git-ignored). Requirements: Node 20.9+, Google Chrome (`CHROME_PATH` to override),
`jq`, and optionally `redis-server`. `TRACKER_STORE=redis scripts/verify.sh` runs the app itself on Redis
and adds a restart check.

## Layout

```
docs/contract.md            the tracker and agent contract (v1)
src/app/page.tsx            board page (server component)
src/app/actions.ts          server actions used by the board
src/app/_components/        board, ticket panel, deliveries log
src/app/api/issues/...      write-back API
src/app/api/users/route.ts
src/app/api/cron/auto/      Vercel Cron target
src/lib/tracker.ts          ticket changes, auto mode
src/lib/webhook.ts          webhook payload, delivery and retries
src/lib/store/              Upstash Redis and in-memory stores
scripts/                    verify.sh and its helpers
tests/                      Vitest suites
```
