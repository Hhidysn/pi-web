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

  // 6. Every project is listed as a group, so a conversation from another
  //    project opens without switching the workspace first.
  const isExpanded = async (root) =>
    (await page.getByRole("button", { name: `Collapse project: ${root}` }).count()) > 0;
  const setExpanded = async (root, want) => {
    if (await isExpanded(root) === want) return;
    const action = want ? "Expand" : "Collapse";
    await page.getByRole("button", { name: `${action} project: ${root}` }).first().click();
    assert.equal(await isExpanded(root), want, `${root} is ${want ? "open" : "closed"}`);
  };
  await setExpanded(projectA, true);
  await setExpanded(projectB, true);
  await page.getByTitle("Tabs alpha second question", { exact: true }).first().waitFor();
  await page.getByTitle("Tabs beta question", { exact: true }).first().waitFor();
  await setExpanded(projectA, false);
  assert.equal(await page.getByTitle("Tabs alpha second question", { exact: true }).count(), 0,
    "collapsing a project hides its own conversations");
  assert.equal(await page.getByTitle("Tabs beta question", { exact: true }).count(), 1,
    "collapsing one project leaves the other project's conversations listed");
  await page.getByTitle("Tabs beta question", { exact: true }).first().click();
  await page.getByText("Tabs beta answer", { exact: true }).waitFor();
  await tab("Tabs alpha question").waitFor();
  assert.equal(await page.locator("[role='tab']").count(), 2, "a conversation from another project opens as a tab");
  await setExpanded(projectA, true);
  await page.screenshot({ path: join(artifacts, "session-accordion.png") });

  // 7. A group's "+" starts a conversation in that project and moves there.
  await page.getByRole("button", { name: `New conversation in this project: ${projectA}` }).click();
  await page.locator("textarea.chat-input-textarea:visible").first().waitFor();
  await page.getByRole("button", { name: `Collapse project: ${projectA}` }).first().waitFor();
  assert.equal(await page.locator("[role='tab']").count(), 2, "starting a conversation does not disturb the open tabs");

  // 8. Status markers: a polled running session shows 运行中 and the completion
  //    that follows shows 完成 (both on the tab and in the sidebar row).
  let runningNow = [ALPHA];
  await page.route("**/api/agent/running*", (route) => route.fulfill({
    json: {
      sessionListVersion: 1,
      runningSessionIds: runningNow,
      completionNotificationSuppressedSessionIds: [],
    },
  }));
  await tab("Tabs alpha question").locator("[aria-label='Running']").waitFor({ timeout: 10_000 });
  runningNow = [];
  await tab("Tabs alpha question").locator("[aria-label='Done']").waitFor({ timeout: 15_000 });
  assert.equal(await tab("Tabs beta question").locator("[aria-label='Done']").count(), 0,
    "only the conversation that finished is marked done");
  await page.getByTitle("Just finished", { exact: true }).first().waitFor();
  // Choosing the conversation clears the marker: it is no longer news.
  await tab("Tabs alpha question").click();
  await tab("Tabs alpha question").locator("[aria-label='Done']").waitFor({ state: "detached", timeout: 10_000 });
  await page.screenshot({ path: join(artifacts, "session-status.png") });

  // 9. Escape belongs to the conversation on screen. The state endpoints are
  //    mocked, so the hidden conversation looks busy while the shown one is idle.
  const agentPosts = [];
  await page.route("**/api/agent/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && /^\/api\/agent\/[^/]+$/.test(url.pathname)) {
      agentPosts.push({ id: decodeURIComponent(url.pathname.split("/").pop()), body: request.postData() });
      await route.fulfill({ json: { success: true } });
      return;
    }
    await route.continue().catch(() => {});
  });
  await page.route("**/api/sessions/*/state", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]);
    return route.fulfill({
      json: id === BETA
        ? { running: true, state: { isStreaming: true, isPromptRunning: false } }
        : { running: false },
    });
  });
  const abortPosts = () => agentPosts.filter((post) => /"abort"/.test(post.body ?? ""));
  // Reload so both panes read the mocked state while mounting.
  await page.reload({ waitUntil: "domcontentloaded" });
  await tab("Tabs alpha question").waitFor();
  await tab("Tabs beta question").click();
  await page.getByText("Tabs beta answer", { exact: true }).waitFor();
  await tab("Tabs alpha question").click();
  await page.waitForFunction(() => {
    const pane = document.querySelector("[data-session-pane-active='true']");
    return pane !== null && pane.getAttribute("data-session-pane") !== null;
  }, null, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await delay(600);
  assert.deepEqual(abortPosts().map((post) => post.id), [],
    "Escape must not stop a conversation that is only mounted in the background");
  // The visible conversation's own run is the one Escape stops.
  await tab("Tabs beta question").click();
  await page.getByText("Tabs beta answer", { exact: true }).waitFor();
  await delay(600);
  await page.keyboard.press("Escape");
  await delay(900);
  assert.deepEqual(abortPosts().map((post) => post.id), [BETA],
    "Escape stops the conversation the user is looking at");
  await page.unroute("**/api/sessions/*/state");
  await page.unroute("**/api/agent/*");

  // 10. A mounted but hidden conversation stops holding its session warm: only
  //     the visible pane renews its liveness lease (the renew interval is 30 s).
  const leaseRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const match = /^\/api\/agent\/([^/]+)\/lease$/.exec(url.pathname);
    if (match) leaseRequests.push(decodeURIComponent(match[1]));
  });
  await tab("Tabs alpha question").click();
  await delay(35_000);
  assert.ok(leaseRequests.includes(ALPHA), "the visible conversation keeps its session warm");
  assert.ok(!leaseRequests.includes(BETA), "a hidden conversation releases its session once it is idle");

  // 11. Removing a project takes it out of the sidebar list without touching
  //     its conversations; the footer lists it and puts it back.
  const projectListed = async (root) =>
    (await page.getByRole("button", { name: `Expand project: ${root}`, exact: true }).count()) +
    (await page.getByRole("button", { name: `Collapse project: ${root}`, exact: true }).count());
  await setExpanded(projectB, true);
  assert.equal(await projectListed(projectB), 1, "the project is listed before it is removed");
  await page.getByRole("button", { name: `Remove from sidebar (conversations are kept): ${projectB}` }).click();
  await page.getByRole("button", { name: `Collapse project: ${projectB}`, exact: true }).waitFor({ state: "detached", timeout: 10_000 });
  assert.equal(await page.getByTitle("Tabs beta question", { exact: true }).count(), 0,
    "the removed project's conversations leave the list");
  const hiddenFooter = page.locator('[data-hidden-projects="1"]');
  await hiddenFooter.waitFor();
  // Its conversations are untouched: the open tab and the session listing stay.
  assert.equal(await page.locator("[role='tab']").count(), 2, "removing a project does not close its tabs");
  const stillListed = await (await fetch(`${base}/api/sessions`)).json();
  assert.ok(stillListed.sessions.some((session) => session.id === BETA),
    "removing a project must not delete its conversations");
  // The footer lists it with its conversation count and puts it back.
  await page.locator('[data-testid="hidden-projects-toggle"]').click();
  const hiddenRow = page.locator("[data-hidden-project]");
  await hiddenRow.waitFor();
  assert.match(await hiddenRow.innerText(), /beta/, "the hidden row names the project");
  assert.match(await hiddenRow.innerText(), /1/, "the hidden row shows its conversation count");
  await page.screenshot({ path: join(artifacts, "session-hidden-project.png") });
  // It stays removed across a reload (and comes back collapsed, as removing
  // also closed the group).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-hidden-projects="1"]').waitFor();
  assert.equal(await projectListed(projectB), 0,
    "the removed project stays out of the list after a reload");
  await page.locator('[data-testid="hidden-projects-toggle"]').click();
  await page.getByRole("button", { name: `Show again: ${projectB}` }).click();
  await page.locator("[data-hidden-projects]").waitFor({ state: "detached" });
  await page.getByRole("button", { name: `Expand project: ${projectB}`, exact: true }).waitFor();
  await setExpanded(projectB, true);
  assert.equal(await page.getByTitle("Tabs beta question", { exact: true }).count(), 1,
    "showing it again lists its conversations");

  const recoverableErrors = consoleErrors.filter((text) => !/favicon|manifest/i.test(text));
  assert.deepEqual(recoverableErrors, [], "browser errors while using tabs");
  await page.screenshot({ path: join(artifacts, "session-tabs-after-close.png") });
  console.log("PASS: conversation tabs keep panes mounted, switch without refetching, and restore after reload");
  console.log("PASS: the project accordion opens, collapses and starts conversations per project");
  console.log("PASS: running and finished conversations are marked on the tab and in the sidebar");
  console.log("PASS: Escape and session liveness follow the visible conversation, not every mounted pane");
  console.log("PASS: a project can be removed from the list and shown again without losing its conversations");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  if (server) await Promise.race([once(server, "exit"), delay(5000)]).catch(() => {});
}
