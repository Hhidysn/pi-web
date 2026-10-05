import assert from "node:assert/strict";
import test from "node:test";
import {
  DONE_STATUS_WINDOW_MS,
  deriveSessionActivityStatus,
  expireCompletionTimes,
  nextCompletionExpiry,
  parseCompletionTimes,
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

test("completion markers expire once the window has passed", () => {
  const now = 1_000_000;
  const times = { a: now - 10_000, b: now - DONE_STATUS_WINDOW_MS - 1 };
  assert.deepEqual(expireCompletionTimes(times, now), { a: now - 10_000 });
  // Nothing expired: the same object comes back so callers can skip a render.
  const fresh = { a: now };
  assert.equal(expireCompletionTimes(fresh, now), fresh);
  assert.deepEqual(expireCompletionTimes(fresh, now), { a: now });
  assert.deepEqual(expireCompletionTimes({}, now), {});
});

test("the next expiry tells the shell when to wake up again", () => {
  const now = 1_000_000;
  assert.equal(nextCompletionExpiry({}, now), null);
  assert.equal(nextCompletionExpiry({ a: now - 1000, b: now }, now), DONE_STATUS_WINDOW_MS - 1000);
  // An already expired marker asks for an immediate check, never a negative wait.
  assert.equal(nextCompletionExpiry({ a: now - DONE_STATUS_WINDOW_MS - 5000 }, now), 0);
});

test("stored completion markers survive a reload and reject junk", () => {
  assert.deepEqual(parseCompletionTimes('{"a":5,"b":7}'), { a: 5, b: 7 });
  assert.deepEqual(parseCompletionTimes('{"a":5,"b":"x","c":null,"":3}'), { a: 5 });
  assert.deepEqual(parseCompletionTimes("nope"), {});
  assert.deepEqual(parseCompletionTimes("[1,2]"), {});
  assert.deepEqual(parseCompletionTimes(null), {});
});
