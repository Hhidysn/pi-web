"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — every mounted ChatWindow registers the abort handler
// of its own conversation here so that the global Esc listener in AppShell can
// call the visible one without prop-drilling. Keyed by session id (the fresh
// composer registers as "composer"): with several conversations mounted at
// once, a single slot would let a background pane answer — or clear — the
// visible pane's Escape.
// ---------------------------------------------------------------------------
const abortHandlers = new Map<string, () => void>();

/**
 * Register (or clear) one conversation's abort handler.
 * Call this from ChatWindow whenever pane visibility, agentRunning or
 * handleAbort changes.
 */
export function registerAbortHandler(owner: string, handler: (() => void) | null): void {
  if (handler) abortHandlers.set(owner, handler);
  else abortHandlers.delete(owner);
}

/**
 * The global Esc shortcut: stops the running agent, unless the key belongs to
 * something else. Typed into a textarea or input, it is that field's (ChatInput
 * has its own Esc logic). Marked handled already (`defaultPrevented`), it was
 * something nearer's: Settings, a menu or a viewer that closed on it. Those
 * listen on `document` or below and run before this one on `window`, and
 * closing them must not stop a run as well. Returns whether it stopped the
 * agent.
 *
 * `owner` is the visible conversation (its session id, or "composer" for the
 * fresh composer). Without one, a single registered conversation is used, which
 * keeps the shortcut working in tests and before the shell knows the owner.
 */
export function handleGlobalEscape(event: KeyboardEvent, owner?: string | null): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  const handler = owner
    ? abortHandlers.get(owner)
    : abortHandlers.size === 1
      ? [...abortHandlers.values()][0]
      : undefined;
  if (!handler) return false;

  const tag = (event.target as HTMLElement | null)?.tagName;
  // Let textarea/input handle Esc internally (ChatInput menus / stop).
  if (tag === "TEXTAREA" || tag === "INPUT") return false;

  event.preventDefault();
  handler();
  return true;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /** Conversation whose Escape owns the stop shortcut (session id, or
   *  "composer" for the fresh composer). */
  abortOwner?: string | null;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component. Nor is an Esc something nearer
 * already handled (see `handleGlobalEscape()`).
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd, abortOwner } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        handleGlobalEscape(e, abortOwner);
        return;
      }

      // ---- Ctrl+Alt+N: new session ----
      if (e.key === "n" && e.ctrlKey && e.altKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession, abortOwner]);
}
