/**
 * Activity status shown on conversation tabs and (later) in the sidebar.
 *
 * Three states only, all derived from data the client already has:
 * - `running`: the server reports the session in its running set;
 * - `done`: the session left the running set recently and the user has not
 *   looked at it since;
 * - `idle`: nothing is happening.
 *
 * "Recently" is bounded by DONE_STATUS_WINDOW_MS so a completion from an
 * earlier browsing session does not stay green forever.
 */

export type SessionActivityStatus = "running" | "done" | "idle";

/** How long a completion stays visible before the row falls back to idle. */
export const DONE_STATUS_WINDOW_MS = 30 * 60_000;

export type CompletionTimes = Readonly<Record<string, number>>;

/**
 * Status of one session. `completedAt` is cleared when the user opens the
 * session, so a completion the user has seen is not reported again.
 */
export function deriveSessionActivityStatus(
  sessionId: string,
  runningIds: ReadonlySet<string>,
  completedAt: CompletionTimes,
  now = Date.now(),
  doneWindowMs = DONE_STATUS_WINDOW_MS,
): SessionActivityStatus {
  if (runningIds.has(sessionId)) return "running";
  const finishedAt = completedAt[sessionId];
  if (typeof finishedAt === "number" && now - finishedAt < doneWindowMs) return "done";
  return "idle";
}

/** Record a completion time for every session id; returns the same object when nothing changes. */
export function withCompletionTimes(
  completedAt: CompletionTimes,
  sessionIds: readonly string[],
  now = Date.now(),
): CompletionTimes {
  if (sessionIds.length === 0) return completedAt;
  const next: Record<string, number> = { ...completedAt };
  let changed = false;
  for (const id of sessionIds) {
    if (!id) continue;
    next[id] = now;
    changed = true;
  }
  return changed ? next : completedAt;
}

/** Forget one session's completion marker; returns the same object when absent. */
export function withoutCompletionTime(completedAt: CompletionTimes, sessionId: string): CompletionTimes {
  if (!(sessionId in completedAt)) return completedAt;
  const next: Record<string, number> = { ...completedAt };
  delete next[sessionId];
  return next;
}

/**
 * Drop completion markers for sessions that no longer exist in the catalogue.
 */
export function pruneCompletionTimes(completedAt: CompletionTimes, knownSessionIds: ReadonlySet<string>): CompletionTimes {
  const keys = Object.keys(completedAt);
  if (keys.every((key) => knownSessionIds.has(key))) return completedAt;
  const next: Record<string, number> = {};
  for (const key of keys) {
    const value = completedAt[key];
    if (value !== undefined && knownSessionIds.has(key)) next[key] = value;
  }
  return next;
}

/** Drop markers whose completion window has passed. */
export function expireCompletionTimes(
  completedAt: CompletionTimes,
  now = Date.now(),
  doneWindowMs = DONE_STATUS_WINDOW_MS,
): CompletionTimes {
  const kept: Record<string, number> = {};
  let changed = false;
  for (const [id, finishedAt] of Object.entries(completedAt)) {
    if (typeof finishedAt !== "number" || now - finishedAt >= doneWindowMs) {
      changed = true;
      continue;
    }
    kept[id] = finishedAt;
  }
  return changed ? kept : completedAt;
}

/** Milliseconds until the earliest marker expires, or null when there is none. */
export function nextCompletionExpiry(
  completedAt: CompletionTimes,
  now = Date.now(),
  doneWindowMs = DONE_STATUS_WINDOW_MS,
): number | null {
  let earliest: number | null = null;
  for (const finishedAt of Object.values(completedAt)) {
    if (typeof finishedAt !== "number") continue;
    if (earliest === null || finishedAt < earliest) earliest = finishedAt;
  }
  if (earliest === null) return null;
  return Math.max(0, earliest + doneWindowMs - now);
}

/**
 * Completion markers are stored in localStorage so a reload keeps showing
 * "done" for conversations that finished inside the window; without it the
 * status would silently become idle on every page load.
 */
export const COMPLETION_TIMES_STORAGE_KEY = "pi-web:session-completion-times";

/** Raw stored value is a JSON object of session id → completion time. */
export function parseCompletionTimes(raw: string | null): Record<string, number> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const times: Record<string, number> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (id.length === 0 || typeof value !== "number" || !Number.isFinite(value)) continue;
    times[id] = value;
  }
  return times;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCompletionTimes(): Record<string, number> {
  const storage = getBrowserStorage();
  if (!storage) return {};
  try {
    return expireCompletionTimes(parseCompletionTimes(storage.getItem(COMPLETION_TIMES_STORAGE_KEY)));
  } catch {
    return {};
  }
}

export function saveCompletionTimes(completedAt: CompletionTimes): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(COMPLETION_TIMES_STORAGE_KEY, JSON.stringify(completedAt));
  } catch {
    // Quota or a private-mode store: status still works for this page view.
  }
}
