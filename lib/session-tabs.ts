/**
 * Open conversation tabs of the chat area.
 *
 * The sidebar can open a conversation from any project; each opened
 * conversation keeps a tab so the user can switch back without reopening it
 * from the session list. Order is the open order; the user can reorder tabs by
 * dragging. The tab list is persisted in localStorage so a reload restores the
 * conversations that were open, and the URL's `?session=` still decides which
 * of them becomes active.
 *
 * A tab is only a view over a session that already exists on disk: closing a
 * tab never deletes the conversation. Stale ids (session deleted outside the
 * browser) are pruned once the session catalogue has loaded.
 *
 * Stored in localStorage; best-effort (silently ignored when unavailable).
 */

const STORAGE_KEY = "pi-web:open-session-tabs";
const MAX_TABS_STORAGE_KEY = "pi-web:max-open-tabs";

/** Default cap on open conversation tabs; override with the localStorage key above. */
export const DEFAULT_MAX_OPEN_SESSION_TABS = 5;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Raw stored values are a JSON array of session ids; anything else is ignored. */
export function parseOpenSessionTabs(raw: string | null, maxTabs = DEFAULT_MAX_OPEN_SESSION_TABS): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const tabs: string[] = [];
  for (const value of parsed) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    tabs.push(value);
    if (tabs.length >= maxTabs) break;
  }
  return tabs;
}

export function serializeOpenSessionTabs(tabs: readonly string[]): string {
  return JSON.stringify(tabs);
}

/** Maximum open tabs, from the localStorage override when it is a positive integer. */
export function readMaxOpenSessionTabs(storage: StorageLike | null = getBrowserStorage()): number {
  if (!storage) return DEFAULT_MAX_OPEN_SESSION_TABS;
  try {
    const raw = storage.getItem(MAX_TABS_STORAGE_KEY);
    if (!raw) return DEFAULT_MAX_OPEN_SESSION_TABS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OPEN_SESSION_TABS;
  } catch {
    return DEFAULT_MAX_OPEN_SESSION_TABS;
  }
}

export function loadOpenSessionTabs(storage: StorageLike | null = getBrowserStorage()): string[] {
  if (!storage) return [];
  try {
    return parseOpenSessionTabs(storage.getItem(STORAGE_KEY), readMaxOpenSessionTabs(storage));
  } catch {
    return [];
  }
}

export function saveOpenSessionTabs(
  tabs: readonly string[],
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    if (tabs.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, serializeOpenSessionTabs(tabs));
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export interface AddTabResult {
  tabs: string[];
  /** Oldest tab removed to stay within the cap; null when nothing was dropped. */
  droppedId: string | null;
}

/**
 * Append a session id unless it is already open. At the cap, the oldest tab is
 * dropped (the newly opened one stays); an already-open id keeps its position.
 */
export function addOpenSessionTab(
  tabs: readonly string[],
  sessionId: string,
  maxTabs = DEFAULT_MAX_OPEN_SESSION_TABS,
): AddTabResult {
  if (!sessionId) return { tabs: [...tabs], droppedId: null };
  if (tabs.includes(sessionId)) return { tabs: [...tabs], droppedId: null };
  const cap = Math.max(1, maxTabs);
  const next = [...tabs, sessionId];
  if (next.length <= cap) return { tabs: next, droppedId: null };
  const droppedId = next.shift() ?? null;
  return { tabs: next, droppedId };
}

export function removeOpenSessionTab(tabs: readonly string[], sessionId: string): string[] {
  if (!tabs.includes(sessionId)) return [...tabs];
  return tabs.filter((id) => id !== sessionId);
}

/** Move a tab to another index, clamping out-of-range indices. */
export function moveOpenSessionTab(tabs: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= tabs.length || from === to) return [...tabs];
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  const target = Math.max(0, Math.min(to, next.length));
  next.splice(target, 0, moved);
  return next;
}

/**
 * Which tab becomes active after closing `closedId`: the tab to its right, or
 * the one to its left when it was last. Returns null when no tab remains.
 */
export function nextActiveTabAfterClose(
  tabs: readonly string[],
  closedId: string,
  activeId: string | null,
): string | null {
  if (tabs.length === 0) return null;
  if (activeId !== closedId) {
    return activeId && tabs.includes(activeId) ? activeId : tabs[0];
  }
  const index = tabs.indexOf(closedId);
  if (index < 0) return tabs[0];
  return tabs[index + 1] ?? tabs[index - 1] ?? null;
}
