import assert from "node:assert/strict";
import test from "node:test";
import { handleGlobalEscape, registerAbortHandler } from "./useKeyboardShortcuts.ts";

function keydown(key, { tagName = "BUTTON", defaultPrevented = false } = {}) {
  return {
    key,
    target: { tagName },
    defaultPrevented,
    preventDefault() { this.defaultPrevented = true; },
  };
}

test("Escape stops a running agent when nothing else took the key", (t) => {
  let stopped = 0;
  registerAbortHandler("run-a", () => { stopped += 1; });
  t.after(() => registerAbortHandler("run-a", null));

  const event = keydown("Escape");
  assert.equal(handleGlobalEscape(event), true);
  assert.equal(stopped, 1);
  assert.equal(event.defaultPrevented, true);
  // Focus on the page itself, as after a click on nothing in particular.
  assert.equal(handleGlobalEscape(keydown("Escape", { tagName: "BODY" })), true);
  assert.equal(stopped, 2);
  assert.equal(handleGlobalEscape(keydown("Enter")), false);
  assert.equal(stopped, 2);
});

test("an Escape something nearer already handled does not stop the agent too", (t) => {
  let stopped = 0;
  registerAbortHandler("run-a", () => { stopped += 1; });
  t.after(() => registerAbortHandler("run-a", null));

  // Settings, the Mermaid viewer or a menu closed on it and marked it handled.
  assert.equal(handleGlobalEscape(keydown("Escape", { defaultPrevented: true })), false);
  // ChatInput and other fields keep their own Escape.
  assert.equal(handleGlobalEscape(keydown("Escape", { tagName: "TEXTAREA" })), false);
  assert.equal(handleGlobalEscape(keydown("Escape", { tagName: "INPUT" })), false);
  assert.equal(stopped, 0);
});

test("with no run to stop, Escape is left alone", () => {
  registerAbortHandler("run-a", null);
  const event = keydown("Escape");
  assert.equal(handleGlobalEscape(event, "run-a"), false);
  assert.equal(event.defaultPrevented, false);
});

test("Escape stops the conversation the user is looking at, not a background one", (t) => {
  const stopped = [];
  registerAbortHandler("visible", () => stopped.push("visible"));
  registerAbortHandler("background", () => stopped.push("background"));
  t.after(() => {
    registerAbortHandler("visible", null);
    registerAbortHandler("background", null);
  });

  assert.equal(handleGlobalEscape(keydown("Escape"), "visible"), true);
  assert.deepEqual(stopped, ["visible"]);
  // The fresh composer has no run of its own; a mounted background pane must
  // not answer for it.
  assert.equal(handleGlobalEscape(keydown("Escape"), "composer"), false);
  assert.equal(handleGlobalEscape(keydown("Escape"), null), false);
  assert.deepEqual(stopped, ["visible"]);
  // A pane that finished leaves no handler behind for its id.
  registerAbortHandler("visible", null);
  assert.equal(handleGlobalEscape(keydown("Escape"), "visible"), false);
  assert.deepEqual(stopped, ["visible"]);
});
