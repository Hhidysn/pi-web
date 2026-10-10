import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("./open-dev.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function open({ hostname = "127.0.0.1", registrations = [], failed = false } = {}) {
  const origin = `http://${hostname}:30141`;
  const state = { unregistered: [], deleted: [], destinations: [], status: "" };
  const window = { caches: {} };
  Object.defineProperty(window, "localStorage", { get() { assert.fail("draft/preferences storage must be untouched"); } });
  const document = { getElementById() { return { set textContent(value) { state.status = value; } }; } };
  Object.defineProperty(document, "cookie", { get() { assert.fail("login cookies must be untouched"); } });
  const context = {
    URL, window, document,
    location: { hostname, origin, replace: (destination) => state.destinations.push(destination) },
    navigator: { serviceWorker: { getRegistrations: async () => {
      if (failed) throw new Error("storage unavailable");
      return registrations.map(([id, path, kind = "active"]) => ({
        [kind]: { scriptURL: new URL(path, origin).href },
        unregister: async () => { state.unregistered.push(id); return true; },
      }));
    } } },
    caches: {
      keys: async () => ["pi-web-static-old", "pi-web-static-new", "pi-web-drafts", "other-app-cache"],
      delete: async (key) => { state.deleted.push(key); return true; },
    },
  };
  await vm.runInNewContext(script, context);
  return state;
}

test("dev entry removes only this origin's Pi Web workers and static caches before opening the app", async () => {
  const state = await open({ registrations: [
    ["pi-web", "/sw.js?v=old"],
    ["waiting-pi-web", "/sw.js?v=new", "waiting"],
    ["other-worker", "/other-sw.js"],
    ["other-origin", "https://other.test/sw.js"],
  ] });
  assert.deepEqual(state.unregistered, ["pi-web", "waiting-pi-web"]);
  assert.deepEqual(state.deleted, ["pi-web-static-old", "pi-web-static-new"]);
  assert.deepEqual(state.destinations, ["/"]);
  assert.equal(state.status, "");
});

test("proxy/phone origins open the app without changing their production worker or cache", async () => {
  const state = await open({ hostname: "node.tailnet.ts.net", registrations: [["pi-web", "/sw.js"]] });
  assert.deepEqual(state.unregistered, []);
  assert.deepEqual(state.deleted, []);
  assert.deepEqual(state.destinations, ["/"]);
});

test("a cleanup failure shows a retry message instead of repeatedly reloading a broken page", async () => {
  const state = await open({ failed: true });
  assert.deepEqual(state.destinations, []);
  assert.match(state.status, /重新点击快捷方式/);
});
