// Focused fixture for conversation tabs (multi-project, keep-alive switching).
//
//   node e2e/session-tabs.mjs
//   E2E_SERVER_MODE=start node e2e/session-tabs.mjs
//   E2E_BROWSER_CHANNEL=msedge node e2e/session-tabs.mjs   # system browser instead of the bundled one
//
// Seeds two projects with one conversation each, then checks that opening a
// second conversation keeps the first mounted (no reload, no refetch), that
// switching back preserves the transcript, and that a reload restores both
// tabs from storage.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.env.E2E_SERVER_MODE || "dev";
assert.ok(mode === "dev" || mode === "start", "E2E_SERVER_MODE must be dev or start");

const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-tabs-"));
const projectA = join(agentDir, "alpha");
const projectB = join(agentDir, "beta");
mkdirSync(projectA);
mkdirSync(projectB);
mkdirSync(join(agentDir, "extensions"));
const sessionDir = join(agentDir, "sessions", "tabs");
mkdirSync(sessionDir, { recursive: true });

const ALPHA = "tabs-alpha";
const ALPHA_OTHER = "tabs-alpha-second";
const BETA = "tabs-beta";
const timestamp = "2026-08-23T00:00:00.000Z";
const message = (id, parentId, role, content) => ({
  type: "message", id, parentId, timestamp, message: { role, content },
});

function writeSession(id, cwd, entries) {
  const header = { type: "session", version: 3, id, timestamp, cwd };
  writeFileSync(
    join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`),
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

writeSession(ALPHA, projectA, [
  message("a-root", null, "user", "Tabs alpha question"),
  message("a-answer", "a-root", "assistant", "Tabs alpha answer"),
]);
writeSession(ALPHA_OTHER, projectA, [
  message("a2-root", null, "user", "Tabs alpha second question"),
  message("a2-answer", "a2-root", "assistant", "Tabs alpha second answer"),
]);
writeSession(BETA, projectB, [
  message("b-root", null, "user", "Tabs beta question"),
  message("b-answer", "b-root", "assistant", "Tabs beta answer"),
]);

let server;
let browser;
const serverLog = createWriteStream(join(artifacts, "session-tabs-server.log"));
const interrupt = () => {
  process.exitCode = 1;
  server?.kill("SIGTERM");
  void browser?.close().catch(() => {});
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;

  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });

  const deadline = Date.now() + 120_000;
  while (true) {
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.equal(sessions.length, 3, "seed sessions must be catalogued");
      break;
    }
    assert.equal(server.exitCode, null, "Server exited before readiness; see session-tabs-server.log");
    assert.ok(Date.now() < deadline, "Server readiness timed out; see session-tabs-server.log");
    await delay(250);
  }

  browser = await chromium.launch(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  const tab = (title) => page.getByRole("tab", { name: title, exact: true });
  const sessionRow = (title) => page.locator(`[title="${title}"]`).first();
  const contextRequests = [];
  page.on("request", (request) => {
    if (/\/api\/sessions\/[^/]+\/(context|state)/.test(request.url())) contextRequests.push(request.url());
  });

  // 1. First conversation opens as a tab.
  await page.goto(`${base}/?session=${ALPHA}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Tabs alpha answer", { exact: true }).waitFor();
  await tab("Tabs alpha question").waitFor();
  assert.equal(await page.locator("[role='tab']").count(), 1, "one conversation tab after the first open");
  assert.equal(await page.locator("[data-session-pane]").count(), 1);

  // 2. Switch to the other project through the sidebar and open its conversation.
  await page.getByTitle(projectA, { exact: true }).click();
  // Paths contain backslashes on Windows, so match by title instead of a CSS attribute selector.
  await page.getByTitle(projectB, { exact: true }).click();
  // The project switch lands on a fresh composer; open the beta conversation from its list.
  await sessionRow("Tabs beta question").click();
  await page.getByText("Tabs beta answer", { exact: true }).waitFor();
  await tab("Tabs beta question").waitFor();
  assert.equal(await page.locator("[role='tab']").count(), 2, "two conversation tabs after opening another project");
  assert.equal(
    await page.locator("[data-session-pane]").count(),
    2,
    "the first conversation stays mounted after opening a second one",
  );
  assert.equal(await page.locator("[data-session-pane-active='true']").count(), 1, "exactly one visible pane");

  // 3. Switching back reuses the mounted pane: no new history request.
  const beforeSwitch = contextRequests.filter((url) => url.includes(ALPHA)).length;
  await tab("Tabs alpha question").click();
  await page.getByText("Tabs alpha answer", { exact: true }).waitFor();
  await delay(400);
  assert.equal(
    contextRequests.filter((url) => url.includes(ALPHA)).length,
    beforeSwitch,
    "switching back must not refetch the conversation",
  );
  assert.equal(await page.locator("[data-session-pane]").count(), 2, "both panes stay mounted");
  await page.screenshot({ path: join(artifacts, "session-tabs-desktop.png") });

  // 4. A reload restores both tabs and the URL's conversation.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Tabs alpha answer", { exact: true }).waitFor();
  await tab("Tabs alpha question").waitFor();
  await tab("Tabs beta question").waitFor();
  assert.equal(await page.locator("[role='tab']").count(), 2, "stored tabs come back after a reload");
  assert.equal(
    await tab("Tabs alpha question").getAttribute("aria-selected"),
    "true",
    "the URL's conversation is the active tab after a reload",
  );

  // 5. Closing a tab only drops the view, not the conversation.
  await tab("Tabs beta question").hover();
  await page.getByRole("button", { name: "Close conversation: Tabs beta question" }).click();
  assert.equal(await page.locator("[role='tab']").count(), 1, "closing removes one tab");
  const sessions = await (await fetch(`${base}/api/sessions`)).json();
  assert.ok(sessions.sessions.some((session) => session.id === BETA), "closing a tab must not delete the conversation");

  const recoverableErrors = consoleErrors.filter((text) => !/favicon|manifest/i.test(text));
  assert.deepEqual(recoverableErrors, [], "browser errors while using tabs");
  await page.screenshot({ path: join(artifacts, "session-tabs-after-close.png") });
  console.log("PASS: conversation tabs keep panes mounted, switch without refetching, and restore after reload");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  if (server) await Promise.race([once(server, "exit"), delay(5000)]).catch(() => {});
}
