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
  await context.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.fixtureStreams = new Map();
    window.EventSource = class extends NativeEventSource {
      constructor(url, init) {
        super(url, init);
        const match = /^\/api\/agent\/([^/]+)\/events$/.exec(new URL(url, location.href).pathname);
        if (match) window.fixtureStreams.set(decodeURIComponent(match[1]), this);
      }
    };
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  const tabBar = page.getByRole("tablist", { name: "Open conversations" });
  const tab = (title) => tabBar.getByRole("tab", { name: title, exact: true });
  const sessionRow = (id) => page.locator('.session-sidebar a[href$="?session=' + id + '"]');
  const project = (name) => page.locator(".session-tree-group-toggle").filter({ hasText: new RegExp("^" + name + "$") });
  const expand = async (name) => {
    const group = project(name);
    await group.waitFor();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  };
  const pane = (id) => page.locator('[data-session-pane="' + id + '"]');
  const activePane = (id) => page.locator('[data-session-pane="' + id + '"][data-session-pane-active="true"]');
  const contextRequests = [];
  page.on("request", (request) => {
    if (/\/api\/sessions\/tabs-(alpha|beta)(?:[/?]|$)/.test(request.url())) contextRequests.push(request.url());
  });

  await page.goto(base + "/?session=" + ALPHA, { waitUntil: "domcontentloaded" });
  await activePane(ALPHA).getByText("Tabs alpha answer", { exact: true }).waitFor();
  await tab("Tabs alpha question").waitFor();
  const alphaNode = await pane(ALPHA).elementHandle();
  assert.ok(alphaNode);
  const alphaDraft = activePane(ALPHA).locator("textarea.chat-input-textarea");
  await alphaDraft.fill("draft that stays with alpha");
  await expand("beta");
  await sessionRow(BETA).click();
  await activePane(BETA).getByText("Tabs beta answer", { exact: true }).waitFor();
  await tab("Tabs beta question").waitFor();
  assert.equal(await tabBar.getByRole("tab").count(), 2);
  assert.equal(await pane(ALPHA).getAttribute("aria-hidden"), "true");
  assert.equal(await alphaNode.evaluate((node) => node.isConnected), true);
  const before = contextRequests.filter((url) => url.includes(ALPHA)).length;
  await tab("Tabs alpha question").click();
  await activePane(ALPHA).getByText("Tabs alpha answer", { exact: true }).waitFor();
  assert.equal(await alphaDraft.inputValue(), "draft that stays with alpha");
  assert.equal(await alphaNode.evaluate((node) => node.isConnected), true);
  assert.equal(contextRequests.filter((url) => url.includes(ALPHA)).length, before);

  // 后台扩展编辑只能写所属草稿，提示计时从可见时开始。
  await tab("Tabs beta question").click();
  const betaDraft = activePane(BETA).locator("textarea.chat-input-textarea");
  await betaDraft.fill("front stays unchanged");
  await page.waitForFunction((id) => window.fixtureStreams.get(id)?.readyState === EventSource.OPEN, ALPHA);
  await page.evaluate((id) => {
    const events = [
      { type: "extension_ui_request", method: "set_editor_text", id: "edit-background", text: "background draft" },
      { type: "extension_ui_request", method: "notify", id: "notify-background", notifyType: "error", message: "Background notice remains" },
    ];
    for (const event of events) {
      window.fixtureStreams.get(id).dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
    }
  }, ALPHA);
  assert.equal(await betaDraft.inputValue(), "front stays unchanged");
  assert.equal(await betaDraft.evaluate((input) => document.activeElement === input), true);
  await delay(5500);
  await tab("Tabs alpha question").click();
  assert.equal(await alphaDraft.inputValue(), "background draft");
  await activePane(ALPHA).getByText("Background notice remains", { exact: true }).waitFor();

  // 第三个常驻会话仍可打开，更早的后台连接让出 HTTP 请求容量。
  await expand("alpha");
  await sessionRow(ALPHA_OTHER).click();
  await activePane(ALPHA_OTHER).getByText("Tabs alpha second answer", { exact: true }).waitFor();
  await page.waitForFunction((id) => window.fixtureStreams.get(id)?.readyState === EventSource.CLOSED, BETA);
  assert.equal(await tabBar.getByRole("tab").count(), 3);
  assert.equal(await pane(BETA).count(), 1);
  await tab("Tabs alpha second question").hover();
  await page.getByRole("button", { name: "Close conversation: Tabs alpha second question" }).click();
  await tab("Tabs alpha question").click();
  await activePane(ALPHA).getByText("Tabs alpha answer", { exact: true }).waitFor();

  // 打开隐藏项目的标签不应把分组自动显示出来。
  await project("beta").hover();
  await page.getByRole("button", { name: "Hide beta from sidebar (keeps conversations)" }).click();
  const hidden = page.getByRole("button", { name: "Hidden projects · 1" });
  await hidden.waitFor();
  await project("beta").waitFor({ state: "detached" });
  await tab("Tabs beta question").click();
  await activePane(BETA).getByText("Tabs beta answer", { exact: true }).waitFor();
  assert.equal(await project("beta").count(), 0);
  const catalog = await (await fetch(base + "/api/sessions")).json();
  assert.ok(catalog.sessions.some(({ id }) => id === BETA));

  await page.waitForURL("**/?session=" + BETA);
  await page.reload({ waitUntil: "domcontentloaded" });
  await activePane(BETA).getByText("Tabs beta answer", { exact: true }).waitFor();
  await tab("Tabs alpha question").waitFor();
  assert.equal(await tab("Tabs beta question").getAttribute("aria-selected"), "true");
  await hidden.click();
  await page.getByRole("menuitem", { name: "Show beta in sidebar" }).click();
  await project("beta").waitFor();
  await hidden.waitFor({ state: "detached" });
  await page.screenshot({ path: join(artifacts, "session-tabs-desktop.png") });

  // 用官方运行状态验证标记，不再保存另一套完成状态。
  let runningNow = [ALPHA];
  await page.route("**/api/agent/running*", (route) => route.fulfill({
    json: {
      runningSessionIds: runningNow,
      awaitingInputSessionIds: [],
      subagentsActiveSessionIds: [],
      completionNotificationSuppressedSessionIds: [],
      sessionUiStateRevision: null,
      serverNow: Date.now(),
    },
  }));
  await tab("Tabs alpha question").locator('[aria-label="Running"]').waitFor();
  runningNow = [];
  await tab("Tabs alpha question").locator('[aria-label="Done"]').waitFor();
  await page.unroute("**/api/agent/running*");

  // 关闭当前标签回到相邻标签，会话文件仍可读取。
  await tab("Tabs beta question").hover();
  await page.getByRole("button", { name: "Close conversation: Tabs beta question" }).click();
  await pane(BETA).waitFor({ state: "detached" });
  await activePane(ALPHA).getByText("Tabs alpha answer", { exact: true }).waitFor();
  assert.equal((await fetch(base + "/api/sessions/" + BETA)).status, 200);

  await project("alpha").hover();
  await page.getByRole("button", { name: "New session in alpha" }).click();
  await page.locator("textarea.chat-input-textarea:visible").waitFor();
  assert.equal(await pane(ALPHA).getAttribute("aria-hidden"), "true");
  assert.equal(await tabBar.getByRole("tab").count(), 1);
  await tab("Tabs alpha question").click();
  await activePane(ALPHA).getByText("Tabs alpha answer", { exact: true }).waitFor();

  assert.deepEqual(consoleErrors.filter((text) => !/favicon|manifest/i.test(text)), []);
  console.log("PASS: 跨项目标签常驻、草稿、刷新恢复、官方运行状态、关闭和新建");
  console.log("PASS: 隐藏项目时会话与标签保留，刷新后可恢复项目");
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({ path: join(artifacts, "session-tabs-failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  if (server) await Promise.race([once(server, "exit"), delay(5000)]).catch(() => {});
}
