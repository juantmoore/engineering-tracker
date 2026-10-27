// Drives the real board in headless Chrome and prints PASS/FAIL lines.
// Usage: APP_URL=http://127.0.0.1:3123 ARTIFACTS_DIR=artifacts node scripts/ui-check.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.ARTIFACTS_DIR ?? "artifacts";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 960 } });

const columnOf = (key) =>
  page.locator(`[data-issue-key="${key}"]`).evaluate((el) => el.closest("[data-column]")?.getAttribute("data-column"));
const openIssue = async (key) => {
  await page.locator(`[data-issue-key="${key}"]`).click();
  await page.locator(`[data-testid="issue-drawer"][data-key="${key}"]`).waitFor();
};
const closeDrawer = () => page.locator('[data-testid="close-drawer"]').click();
const waitForColumn = (key, column) =>
  page.waitForFunction(
    ([k, c]) => document.querySelector(`[data-issue-key="${k}"]`)?.closest("[data-column]")?.getAttribute("data-column") === c,
    [key, column],
    { timeout: 10_000 },
  );

try {
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.locator('[data-testid="board"]').waitFor();

  const columns = await page.locator("[data-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")));
  check("board shows the five status columns", JSON.stringify(columns) === JSON.stringify(["To Do", "In Progress", "In Review", "Blocked", "Done"]), columns.join(", "));
  const keys = await page.locator("[data-issue-key]").evaluateAll((els) => els.map((e) => e.getAttribute("data-issue-key")));
  check("board loads the 8 seeded WIT tickets", keys.length === 8 && [10, 11, 12, 13, 14, 15, 16, 17].every((n) => keys.includes(`WIT-${n}`)), keys.join(", "));
  await page.screenshot({ path: `${OUT}/01-board.png` });

  const from = await columnOf("WIT-11");
  await openIssue("WIT-11");
  await page.locator('[data-testid="issue-drawer"] select[name="status"]').selectOption("In Review");
  await waitForColumn("WIT-11", "In Review");
  await closeDrawer();
  await page.reload({ waitUntil: "networkidle" });
  const after = await columnOf("WIT-11");
  check("status change via select persists across reload", after === "In Review", `WIT-11: ${from} -> ${after}`);
  await page.screenshot({ path: `${OUT}/02-status-change.png` });

  await page.locator('[data-issue-key="WIT-14"]').dragTo(page.locator('[data-column="Blocked"]'));
  await waitForColumn("WIT-14", "Blocked").catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  check("drag and drop moves a ticket and persists", (await columnOf("WIT-14")) === "Blocked", `WIT-14 now in ${await columnOf("WIT-14")}`);

  await openIssue("WIT-11");
  await page.locator('[data-testid="issue-drawer"] select[name="assignee"]').selectOption("u-mei");
  await page.waitForFunction(() => document.querySelector('[data-issue-key="WIT-11"]')?.getAttribute("data-assignee") === "u-mei", null, { timeout: 10_000 }).catch(() => {});
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
} catch (e) {
  check("ui flow completed without errors", false, String(e).split("\n")[0]);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
