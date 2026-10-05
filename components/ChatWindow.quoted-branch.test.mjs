import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("offers compact quoting controls and sends branch questions through the main chat", async () => {
  const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

  assert.match(chatSource, /onPointerUp=\{captureQuotedSelection\}/);
  assert.match(chatSource, /closest<HTMLElement>\("\[data-message-role=/);
  assert.match(chatSource, /chatInputRef\?\.current\?\.insertText\(buildQuotedSelection/);
  assert.match(chatSource, /onAskInNewChat\([\s\S]*?sourceSessionId,[\s\S]*?quotedSelection\.sourceEntryId/);
  assert.match(shellSource, /type: "fork_branch"/);
  assert.match(shellSource, /initialPrompt=\{pendingQuotePrompt\?\.sessionId === session\.id/);
  // One chat pane per open conversation plus the null-session composer, each
  // pane keyed by session id so switching tabs reuses the mounted instance.
  assert.equal((shellSource.match(/<ChatWindow\b/g) ?? []).length, 2);
  assert.match(shellSource, /const paneKeyFor = useCallback\(\(session: SessionInfo\): string => \{/);
  assert.match(shellSource, /return `\$\{session\.id\}:\$\{tabReloads\[session\.id\] \?\? 0\}`/);
  // The composer's pane keeps the composer key until it is reloaded, so the
  // first message does not remount the chat it was sent from.
  assert.match(shellSource, /if \(session\.id === promotedPaneId && !tabReloads\[session\.id\]\) return "composer"/);
  assert.match(shellSource, /key=\{paneKeyFor\(session\)\}/);
  assert.match(chatSource, /onInitialPromptConsumed\?\.\(\);\s*void handleSend\(initialPrompt\)/);
  assert.match(chatSource, /role=\{quoteInputOpen \? "dialog" : "toolbar"\}/);
});

test("keeps the selection toolbar above the session sidebar", async () => {
  const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

  const toolbar = chatSource.match(/role=\{quoteInputOpen \? "dialog" : "toolbar"\}[\s\S]*?zIndex:\s*(\d+)/);
  const sidebar = shellSource.match(/id="session-sidebar"[\s\S]*?zIndex:\s*(\d+)/);

  assert.ok(toolbar, "expected quote toolbar z-index");
  assert.ok(sidebar, "expected session sidebar z-index");
  assert.ok(
    Number(toolbar[1]) > Number(sidebar[1]),
    `quote toolbar z-index ${toolbar[1]} should be above session sidebar z-index ${sidebar[1]}`,
  );
});

test("the quote popover and its document listeners belong to the visible pane", async () => {
  const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  // The popover is portaled to <body>, so hiding the pane wrapper is not enough:
  // a hidden conversation must not leave an interactive dialog on screen.
  assert.match(chatSource, /\{paneVisible && quoteSelectionEnabled && quotedSelection && createPortal\(/);
  assert.match(chatSource, /if \(!paneVisible \|\| !quotedSelection\) return;/);
  assert.match(chatSource, /\}, \[paneVisible, quotedSelection, quoteInputOpen, quoteSubmitting, closeQuotedSelection\]\);/);
  // The pane's own Escape stops only its own run.
  assert.match(chatSource, /registerAbortHandler\(owner, paneVisible && sessionBusy \? handleAbort : null\)/);
  assert.match(chatSource, /return \(\) => registerAbortHandler\(owner, null\);/);
  assert.match(chatSource, /active: paneVisible,/);
});
