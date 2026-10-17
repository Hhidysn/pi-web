/**
 * Subagent sessions the `pi-subagents` extension writes for its runs.
 *
 * The extension nests a run's session below the parent session's own file, in a
 * directory named after it: `<sessions>/<project>/<timestamp>_<parent id>/<run id>/run-<n>/session.jsonl`
 * (its executor builds `sessionRoot/run-${index ?? 0}/session.jsonl`). Nothing
 * inside such a file says whose run it is: its header carries no `parentSession`
 * and the extension writes no pi-web subagent marker (`lib/subagents.ts`), so
 * this layout is the whole relation. The session id inside is unrelated to both
 * directory names, and the filename never carries it, so only the header can
 * answer an id lookup.
 *
 * Limits, both deliberate: the extension's own run status remains the live
 * source for a run's state (a nested row's status is `interrupted`, which the
 * UI shows dim; nothing in the file records a completion), and only this layout
 * is recognized — a session the extension forks into
 * `<parent>/forks/<timestamp>_<id>.jsonl` stays undiscovered, as does anything
 * nesting deeper than `run-<n>`.
 */

import { readdir, stat } from "fs/promises";
import { basename, dirname, join } from "path";
import type { Dirent } from "fs";
import type { SubagentSessionStatus } from "./types";

/** `<timestamp>_<session id>`: how the SDK names a session file, and how the extension names the directory of that session's child runs. */
const PARENT_SESSION_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
/** One attempt of a run id (`run-0`, `run-1`, …). */
const RUN_DIR_PATTERN = /^run-\d+$/;
const NESTED_SESSION_FILE = "session.jsonl";
/** Shown as the relation's profile: the extension, not one of pi-web's profiles. */
export const NESTED_SUBAGENT_PROFILE = "pi-subagents";

export interface NestedSubagentSessionFile {
  filePath: string;
  /** The session whose directory holds this run, read from the directory name. */
  parentSessionId: string;
  /** The extension's run id: the directory above `run-<n>`. */
  runId: string;
}

/** What a session row shows for one nested run, under `relation.kind = "subagent"`. */
export interface NestedSubagentRelation {
  kind: "subagent";
  parentSessionId: string;
  profile: string;
  description: string;
  status: SubagentSessionStatus;
}

/** The parent session id the `<timestamp>_<id>` directory name holds, or null for any other shape. */
function parentSessionIdOf(dirName: string): string | null {
  if (!PARENT_SESSION_DIR_PATTERN.test(dirName)) return null;
  // The timestamp itself holds no `_`, so the first one separates the two parts.
  const separator = dirName.indexOf("_");
  return separator < 0 ? null : dirName.slice(separator + 1);
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Every nested subagent session one project's session directory holds.
 *
 * A candidate counts only when the directory shape and the parent session's own
 * sibling `.jsonl` agree: the parent file's presence is what tells a session's
 * directory from any other folder that happens to be named after one. An
 * unreadable directory counts as absent, as an unreadable project directory
 * does for the ordinary scan.
 */
export async function nestedSubagentSessionFiles(projectPath: string): Promise<NestedSubagentSessionFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(projectPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const fileNames = new Set(entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name));

  const found: NestedSubagentSessionFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parentSessionId = parentSessionIdOf(entry.name);
    if (!parentSessionId || !fileNames.has(`${entry.name}.jsonl`)) continue;

    const parentDir = join(projectPath, entry.name);
    for (const runId of await readdir(parentDir).catch(() => [] as string[])) {
      const runDir = join(parentDir, runId);
      for (const attempt of await readdir(runDir).catch(() => [] as string[])) {
        if (!RUN_DIR_PATTERN.test(attempt)) continue;
        const filePath = join(runDir, attempt, NESTED_SESSION_FILE);
        if (!await isFile(filePath)) continue;
        found.push({ filePath, parentSessionId, runId });
      }
    }
  }
  return found.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * The nested session file whose header id is `sessionId`, or null. `readHeader`
 * is the caller's bounded header read (`readSessionHeader()` in
 * `lib/session-reader.ts`), so a match carries the same authority as a flat
 * candidate's and no filename is trusted.
 */
export async function findNestedSessionPathById(
  sessionId: string,
  projectPath: string,
  readHeader: (filePath: string) => { id?: string } | null,
): Promise<string | null> {
  for (const candidate of await nestedSubagentSessionFiles(projectPath)) {
    try {
      if (readHeader(candidate.filePath)?.id === sessionId) return candidate.filePath;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The subagent relation one nested session file's own path implies, or null for
 * any other path. Only the path is read: the file itself is the catalogue's
 * business, and a candidate reaches a row only through
 * `nestedSubagentSessionFiles()`, which has already checked the parent's file.
 */
export function nestedSubagentRelation(filePath: string): NestedSubagentRelation | null {
  if (basename(filePath) !== NESTED_SESSION_FILE) return null;
  const runDir = dirname(dirname(filePath));
  const parentSessionId = parentSessionIdOf(basename(dirname(runDir)));
  if (!parentSessionId || !RUN_DIR_PATTERN.test(basename(dirname(filePath)))) return null;
  const runId = basename(runDir);
  if (!runId) return null;
  return {
    kind: "subagent",
    parentSessionId,
    profile: NESTED_SUBAGENT_PROFILE,
    // The run id is a UUID: its head is what tells two runs apart on a row.
    description: `Run ${runId.slice(0, 8)}`,
    status: "interrupted",
  };
}
