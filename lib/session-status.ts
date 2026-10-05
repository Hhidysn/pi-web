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

/** Drop completion markers for sessions that no longer exist in the catalogue. */
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
