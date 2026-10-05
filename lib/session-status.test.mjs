import assert from "node:assert/strict";
import test from "node:test";
import {
  DONE_STATUS_WINDOW_MS,
  deriveSessionActivityStatus,
  pruneCompletionTimes,
  withCompletionTimes,
  withoutCompletionTime,
} from "./session-status.ts";

test("running wins over a recorded completion", () => {
  const running = new Set(["a"]);
  assert.equal(deriveSessionActivityStatus("a", running, { a: 1 }, DONE_STATUS_WINDOW_MS), "running");
});

test("a recent completion is done and an old one falls back to idle", () => {
  const now = 1_000_000;
  assert.equal(deriveSessionActivityStatus("a", new Set(), { a: now - 1000 }, now), "done");
  assert.equal(deriveSessionActivityStatus("a", new Set(), { a: now - DONE_STATUS_WINDOW_MS - 1 }, now), "idle");
});

test("unknown sessions are idle", () => {
  assert.equal(deriveSessionActivityStatus("x", new Set(), {}), "idle");
});

test("withCompletionTimes records every id and keeps the same object when empty", () => {
  const base = { a: 1 };
  assert.equal(withCompletionTimes(base, []), base);
  assert.deepEqual(withCompletionTimes(base, ["b", "c"], 42), { a: 1, b: 42, c: 42 });
});

test("withoutCompletionTime drops one id and keeps the same object when absent", () => {
  const base = { a: 1, b: 2 };
  assert.equal(withoutCompletionTime(base, "z"), base);
  assert.deepEqual(withoutCompletionTime(base, "a"), { b: 2 });
});

test("prune keeps only known sessions and keeps the same object when nothing is stale", () => {
  const base = { a: 1, b: 2 };
  assert.equal(pruneCompletionTimes(base, new Set(["a", "b"])), base);
  assert.deepEqual(pruneCompletionTimes(base, new Set(["b"])), { b: 2 });
});
