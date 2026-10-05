import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAX_OPEN_SESSION_TABS,
  addOpenSessionTab,
  loadOpenSessionTabs,
  moveOpenSessionTab,
  nextActiveTabAfterClose,
  parseOpenSessionTabs,
  readMaxOpenSessionTabs,
  removeOpenSessionTab,
  saveOpenSessionTabs,
  serializeOpenSessionTabs,
} from "./session-tabs.ts";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("parses a stored id list and ignores malformed values", () => {
  assert.deepEqual(parseOpenSessionTabs(null), []);
  assert.deepEqual(parseOpenSessionTabs(""), []);
  assert.deepEqual(parseOpenSessionTabs("not json"), []);
  assert.deepEqual(parseOpenSessionTabs('{"a":1}'), []);
  assert.deepEqual(parseOpenSessionTabs('["a","b"]'), ["a", "b"]);
});

test("parse drops duplicates, non-strings, and empty ids", () => {
  assert.deepEqual(parseOpenSessionTabs('["a","a","",5,null,"b"]'), ["a", "b"]);
});

test("parse truncates to the tab cap", () => {
  assert.deepEqual(parseOpenSessionTabs('["a","b","c"]', 2), ["a", "b"]);
});

test("add appends a new id and keeps an existing id in place", () => {
  assert.deepEqual(addOpenSessionTab(["a"], "b"), { tabs: ["a", "b"], droppedId: null });
  assert.deepEqual(addOpenSessionTab(["a", "b"], "a"), { tabs: ["a", "b"], droppedId: null });
});

test("add drops the oldest tab at the cap", () => {
  const result = addOpenSessionTab(["a", "b", "c"], "d", 3);
  assert.deepEqual(result.tabs, ["b", "c", "d"]);
  assert.equal(result.droppedId, "a");
});

test("add ignores an empty id and keeps the same list", () => {
  assert.deepEqual(addOpenSessionTab(["a"], ""), { tabs: ["a"], droppedId: null });
});

test("remove only touches an existing id", () => {
  assert.deepEqual(removeOpenSessionTab(["a", "b"], "a"), ["b"]);
  const same = ["a", "b"];
  assert.deepEqual(removeOpenSessionTab(same, "z"), same);
});

test("move reorders and clamps out-of-range targets", () => {
  assert.deepEqual(moveOpenSessionTab(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveOpenSessionTab(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveOpenSessionTab(["a", "b", "c"], 1, 99), ["a", "c", "b"]);
  assert.deepEqual(moveOpenSessionTab(["a", "b"], 5, 0), ["a", "b"]);
});

test("close picks the right neighbor, or null when no tab remains", () => {
  assert.equal(nextActiveTabAfterClose(["a", "b", "c"], "b", "b"), "c");
  assert.equal(nextActiveTabAfterClose(["a", "b", "c"], "c", "c"), "b");
  assert.equal(nextActiveTabAfterClose(["a"], "a", "a"), null);
  assert.equal(nextActiveTabAfterClose([], "a", "a"), null);
  // Closing an inactive tab keeps the current one.
  assert.equal(nextActiveTabAfterClose(["a", "b"], "b", "a"), "a");
});

test("load and save round-trip through storage and clear the key when empty", () => {
  const storage = createStorage();
  saveOpenSessionTabs(["a", "b"], storage);
  assert.equal(storage.values.get("pi-web:open-session-tabs"), serializeOpenSessionTabs(["a", "b"]));
  assert.deepEqual(loadOpenSessionTabs(storage), ["a", "b"]);
  saveOpenSessionTabs([], storage);
  assert.equal(storage.values.has("pi-web:open-session-tabs"), false);
  assert.deepEqual(loadOpenSessionTabs(storage), []);
});

test("max tabs default and override from storage", () => {
  assert.equal(readMaxOpenSessionTabs(createStorage()), DEFAULT_MAX_OPEN_SESSION_TABS);
  assert.equal(readMaxOpenSessionTabs(createStorage({ "pi-web:max-open-tabs": "9" })), 9);
  assert.equal(readMaxOpenSessionTabs(createStorage({ "pi-web:max-open-tabs": "0" })), DEFAULT_MAX_OPEN_SESSION_TABS);
  assert.equal(readMaxOpenSessionTabs(createStorage({ "pi-web:max-open-tabs": "junk" })), DEFAULT_MAX_OPEN_SESSION_TABS);
});

test("load honors the stored cap", () => {
  const storage = createStorage({
    "pi-web:open-session-tabs": JSON.stringify(["a", "b", "c"]),
    "pi-web:max-open-tabs": "2",
  });
  assert.deepEqual(loadOpenSessionTabs(storage), ["a", "b"]);
});

test("storage failures never throw", () => {
  const hostile = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.deepEqual(loadOpenSessionTabs(hostile), []);
  assert.equal(readMaxOpenSessionTabs(hostile), DEFAULT_MAX_OPEN_SESSION_TABS);
  saveOpenSessionTabs(["a"], hostile);
});
