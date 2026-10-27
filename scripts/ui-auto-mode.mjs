// Turns auto mode on (or off) through the real UI toggle and checks it persists across a reload.
// Usage: APP_URL=... AUTO_MODE=on node scripts/ui-auto-mode.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const WANT = (process.env.AUTO_MODE ?? "on") === "on";
const OUT = process.env.ARTIFACTS_DIR ?? "artifacts";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 960 } });
let ok = false;
let detail = "";
try {
  await page.goto(APP, { waitUntil: "networkidle" });
  const toggle = page.locator('[data-testid="auto-mode-toggle"]');
  if ((await toggle.getAttribute("aria-checked")) !== String(WANT)) {
    await toggle.click();
    await page.waitForFunction(
      (want) => document.querySelector('[data-testid="auto-mode-toggle"]')?.getAttribute("aria-checked") === String(want),
      WANT,
      { timeout: 10_000 },
    );
  }
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  const state = await page.locator('[data-testid="auto-mode-toggle"]').getAttribute("aria-checked");
  ok = state === String(WANT);
  detail = `toggle aria-checked=${state} after reload`;
  await page.screenshot({ path: `${OUT}/05-auto-mode-${WANT ? "on" : "off"}.png` });
} catch (e) {
  detail = String(e).split("\n")[0];
} finally {
  await browser.close();
}
console.log(`  ${ok ? "PASS" : "FAIL"}  auto mode toggled ${WANT ? "on" : "off"} in the UI and persisted\n        ${detail}`);
process.exit(ok ? 0 : 1);
