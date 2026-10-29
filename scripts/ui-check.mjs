// Drives the real board in headless Chrome and prints PASS/FAIL lines.
// With RECEIVER_URL set, also asserts on the webhooks the local receiver captured.
// Usage: APP_URL=... [RECEIVER_URL=... EXPECT_WEBHOOK_SECRET=...] ARTIFACTS_DIR=artifacts node scripts/ui-check.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const RECEIVER = process.env.RECEIVER_URL;
const SECRET = process.env.EXPECT_WEBHOOK_SECRET;
const OUT = process.env.ARTIFACTS_DIR ?? "artifacts";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

const receiver = {
  reset: () => fetch(`${RECEIVER}/__reset`, { method: "POST" }),
  control: (body) => fetch(`${RECEIVER}/__control`, { method: "POST", body: JSON.stringify(body) }),
  requests: async () => (await fetch(`${RECEIVER}/__requests`)).json(),
  /** Waits until at least `n` requests arrived, then a little longer so extra deliveries would show up. */
  async waitFor(n, timeoutMs = 10_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && (await this.requests()).length < n) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 1500));
    return this.requests();
  },
};

const redact = (req) => ({
  ...req,
  headers: { ...req.headers, "x-webhook-secret": req.headers["x-webhook-secret"] === SECRET ? "<matches TRACKER_WEBHOOK_SECRET>" : "<MISMATCH>" },
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 960 } });

const columnOf = (key) =>
  page.locator(`[data-issue-key="${key}"]`).evaluate((el) => el.closest("[data-column]")?.getAttribute("data-column"));
const openIssue = async (key) => {
  await page.locator(`[data-issue-key="${key}"]`).click();
  await page.locator(`[data-testid="issue-drawer"][data-key="${key}"]`).waitFor();
};
const closeDrawer = () => page.locator('[data-testid="close-drawer"]').click();
/** The optimistic UI updates instantly; wait until the server action has actually saved. */
const settled = () => page.locator('.app[data-pending="false"]').waitFor({ timeout: 10_000 });
const waitForColumn = (key, column) =>
  page.waitForFunction(
    ([k, c]) => document.querySelector(`[data-issue-key="${k}"]`)?.closest("[data-column]")?.getAttribute("data-column") === c,
    [key, column],
    { timeout: 10_000 },
  );

try {
  if (RECEIVER) await receiver.reset();
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.locator('[data-testid="board"]').waitFor();

  const columns = await page.locator("[data-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")));
  check("board shows the five status columns", JSON.stringify(columns) === JSON.stringify(["To Do", "In Progress", "In Review", "Blocked", "Done"]), columns.join(", "));
  const keys = await page.locator("[data-issue-key]").evaluateAll((els) => els.map((e) => e.getAttribute("data-issue-key")));
  check("board loads the 8 seeded WIT tickets", keys.length === 8 && [10, 11, 12, 13, 14, 15, 16, 17].every((n) => keys.includes(`WIT-${n}`)), keys.join(", "));
  await page.screenshot({ path: `${OUT}/01-board.png` });

  // Status change through the select in the ticket drawer.
  const from = await columnOf("WIT-11");
  await openIssue("WIT-11");
  await page.locator('[data-testid="issue-drawer"] select[name="status"]').selectOption("In Review");
  await waitForColumn("WIT-11", "In Review");
  await settled();
  await closeDrawer();
  await page.reload({ waitUntil: "networkidle" });
  const after = await columnOf("WIT-11");
  check("status change via select persists across reload", after === "In Review", `WIT-11: ${from} -> ${after}`);
  await page.screenshot({ path: `${OUT}/02-status-change.png` });

  let statusEventId = null;
  if (RECEIVER) {
    const reqs = await receiver.waitFor(1);
    check("status change fired exactly one webhook", reqs.length === 1, `receiver got ${reqs.length} request(s)`);
    const [req] = reqs;
    if (req) {
      statusEventId = req.body?.eventId;
      writeFileSync(`${OUT}/webhook-status-change.json`, JSON.stringify(redact(req), null, 2));
      const item = { fromString: null, toString: null, ...req.body?.changelog?.items?.[0] };
      check(
        "webhook body is Jira-shaped",
        req.method === "POST" && req.path === "/jira/events" && req.body.webhookEvent === "jira:issue_updated" &&
          req.body.issue_event_type_name === "issue_generic" && req.body.issue.key === "WIT-11" && req.body.issue.id === "10011" &&
          req.body.issue.fields.status.name === "In Review" && req.body.user.accountId === "u-patrick" &&
          item.field === "status" && item.from === "to_do" && item.to === "in_review",
        `${req.method} ${req.path} ${req.body.webhookEvent} ${req.body.issue.key} ${item.field}: ${item.fromString} -> ${item.toString}`,
      );
      check("X-Webhook-Secret header matches TRACKER_WEBHOOK_SECRET", Boolean(SECRET) && req.headers["x-webhook-secret"] === SECRET);
      check(
        "eventId is a uuid v4 and equals X-Atlassian-Webhook-Identifier",
        UUID.test(statusEventId ?? "") && req.headers["x-atlassian-webhook-identifier"] === statusEventId,
        `eventId ${statusEventId}`,
      );
      check("content-type is application/json", req.headers["content-type"] === "application/json");
    }
  }

  // Drag and drop.
  await page.locator('[data-issue-key="WIT-14"]').dragTo(page.locator('[data-column="Blocked"]'));
  await waitForColumn("WIT-14", "Blocked").catch(() => {});
  await settled();
  await page.reload({ waitUntil: "networkidle" });
  check("drag and drop moves a ticket and persists", (await columnOf("WIT-14")) === "Blocked", `WIT-14 now in ${await columnOf("WIT-14")}`);
  if (RECEIVER) {
    const reqs = await receiver.waitFor(2);
    const ids = reqs.map((r) => r.body?.eventId);
    check("drag fired one more webhook with a new eventId", reqs.length === 2 && ids[1] !== ids[0], `eventIds: ${ids.join(", ")}`);
  }

  // Assignee change while the receiver fails the first two deliveries.
  if (RECEIVER) await receiver.control({ fail: 2, status: 503 });
  await openIssue("WIT-11");
  await page.locator('[data-testid="issue-drawer"] select[name="assignee"]').selectOption("u-mei");
  await page.waitForFunction(() => document.querySelector('[data-issue-key="WIT-11"]')?.getAttribute("data-assignee") === "u-mei", null, { timeout: 10_000 }).catch(() => {});
  await settled();
  if (RECEIVER) {
    const reqs = (await receiver.waitFor(5, 15_000)).slice(2);
    const ids = new Set(reqs.map((r) => r.body?.eventId));
    writeFileSync(`${OUT}/webhook-retries.json`, JSON.stringify(reqs.map(redact), null, 2));
    check(
      "failed delivery is retried with the same eventId (503, 503, 202)",
      reqs.length === 3 && ids.size === 1 && reqs.map((r) => r.respondedWith).join() === "503,503,202" &&
        reqs.every((r) => r.headers["x-atlassian-webhook-identifier"] === r.body.eventId),
      `${reqs.length} attempts, eventIds: ${[...ids].join(", ")}, responses: ${reqs.map((r) => r.respondedWith).join(", ")}`,
    );
    const item = { fromString: null, toString: null, ...reqs[0]?.body?.changelog?.items?.[0] };
    check("assignee webhook carries field assignee", item.field === "assignee" && item.to === "u-mei", `${item.fromString} -> ${item.toString}`);
  }

  const text = `UI check comment ${Date.now()}`;
  await page.locator('[data-testid="comment-input"]').fill(text);
  await page.locator('[data-testid="comment-submit"]').click();
  await page.locator('[data-testid="comment"]', { hasText: text }).waitFor({ timeout: 10_000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  const assignee = await page.locator('[data-issue-key="WIT-11"]').getAttribute("data-assignee");
  check("assignee change persists across reload", assignee === "u-mei", `WIT-11 assignee: ${assignee}`);
  await openIssue("WIT-11");
  const comments = await page.locator('[data-testid="comment"]').allInnerTexts();
  check("new comment persists across reload", comments.some((c) => c.includes(text)), `${comments.length} comments on WIT-11`);
  await page.screenshot({ path: `${OUT}/03-comments.png` });
  await closeDrawer();
  if (RECEIVER) {
    const reqs = await receiver.waitFor(6, 1000);
    check("adding a comment fires no webhook", reqs.length === 5, `receiver total ${reqs.length}`);
  }

  if (RECEIVER) {
    const rows = page.locator('[data-testid="delivery"]');
    await rows.first().waitFor({ timeout: 10_000 });
    const logged = await rows.evaluateAll((els) =>
      els.map((e) => ({ eventId: e.getAttribute("data-event-id"), status: e.getAttribute("data-status-code") })),
    );
    check(
      "deliveries log shows the status-change eventId with HTTP 202",
      logged.some((d) => d.eventId === statusEventId && d.status === "202"),
      `${logged.length} rows in the log`,
    );
    check("deliveries log shows the 503 retries", logged.filter((d) => d.status === "503").length === 2);
    await page.locator('[data-testid="deliveries"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/04-deliveries.png`, fullPage: true });
  }
} catch (e) {
  check("ui flow completed without errors", false, String(e).split("\n")[0]);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
