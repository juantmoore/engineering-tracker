# Engineering Tracker <-> eve agent contract (v1)

The two apps share nothing except this HTTP contract.

## 1. Tracker -> agent (webhook)

POST {AGENT_BASE_URL}/jira/events

Headers:
- Content-Type: application/json
- X-Webhook-Secret: {TRACKER_WEBHOOK_SECRET}   (same value set in both Vercel projects; agent returns 401 if missing or wrong, compared in constant time)
- X-Atlassian-Webhook-Identifier: {eventId}    (same value as body.eventId; Jira Cloud sends this header on real webhooks)

Body (modeled on Jira Cloud's jira:issue_updated webhook):
```json
{
  "webhookEvent": "jira:issue_updated",
  "issue_event_type_name": "issue_generic",
  "eventId": "uuid-v4, unique per event, reused on redelivery",
  "timestamp": 1761604800000,
  "user": { "accountId": "u-patrick", "displayName": "Patrick Hughes" },
  "issue": {
    "id": "10012",
    "key": "WIT-12",
    "self": "{TRACKER_BASE_URL}/api/issues/WIT-12",
    "fields": {
      "summary": "Ticket title",
      "status": { "name": "In Review" },
      "assignee": { "accountId": "u-sam", "displayName": "Sam Lee" },
      "updated": "2026-10-27T22:00:00.000Z"
    }
  },
  "changelog": {
    "id": "uuid",
    "items": [
      { "field": "status", "fieldtype": "jira", "from": "in_progress", "fromString": "In Progress", "to": "in_review", "toString": "In Review" }
    ]
  }
}
```
Statuses: To Do, In Progress, In Review, Blocked, Done. assignee may be null. Assignee changes use the same shape with field "assignee".
The agent answers 2xx quickly (202 is fine). The Tracker retries on non-2xx or timeout with the SAME eventId, so the agent dedupes on eventId.

## 2. Agent -> Tracker (write-back API)

Base: {TRACKER_BASE_URL}. Every request: `Authorization: Bearer {TRACKER_API_KEY}`; 401 otherwise. JSON in and out.

- GET  /api/issues                      -> { "issues": [Issue] }
- GET  /api/issues/{key}                -> Issue (404 if unknown)
- POST /api/issues/{key}/comments       body { "body": "text", "author": "workit-agent" } -> 201 Comment
- PUT  /api/issues/{key}/assignee       body { "accountId": "u-sam" | null } -> Issue
- POST /api/issues/{key}/transitions    body { "status": "In Review" } -> Issue
- GET  /api/users                       -> { "users": [{ "accountId", "displayName" }] }

Issue = { id, key, summary, status, assignee: {accountId, displayName} | null, comments: [Comment], updated }
Comment = { id, body, author, created }

Write-back changes made through this API also fire the webhook in section 1 (with `user` = the agent), like Jira does. Errors: { "error": "message" } with 400/401/404.
