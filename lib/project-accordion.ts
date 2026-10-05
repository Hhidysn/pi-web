/**
 * Project accordion of the sidebar.
 *
 * The sidebar lists every project as a collapsible group: the header row holds
 * the project path and its activity, the rows under it are that project's
 * conversations. Groups are ordered by recent activity, and the open/closed
 * state is remembered, so the list stays usable without switching the
 * workspace first.
 *
 * Rows are laid out as one absolute list. A group header is shorter than a
 * conversation row, so the windowing helper below works from the measured row
 * heights instead of a single fixed row size. Everything here is pure; the
 * sidebar owns the React state and the storage side effects.
 */

import type { SessionInfo } from "./types";
import { getRecentProjects, type RecentProject } from "./project-groups";

export const PROJECT_GROUP_ROW_HEIGHT = 34;
/** Conversation rows keep the sidebar's fixed session row height. */
export const SESSION_ROW_HEIGHT = 54;

export const EXPANDED_PROJECTS_STORAGE_KEY = "pi-web:expanded-project-keys";

const DEFAULT_OVERSCAN = 6;

export interface AccordionSection<T> {
  /** Stable group identity (a project key). */
  key: string;
  expanded: boolean;
  items: readonly T[];
}

export interface AccordionRow<T> {
  kind: "group" | "item";
  /** React key: the group key for headers, the item key for conversation rows. */
  key: string;
  /** Group this row belongs to (a header belongs to itself). */
  sectionKey: string;
  height: number;
  item?: T;
}

export interface AccordionLayout<T> {
  rows: AccordionRow<T>[];
  /** Top offset of every row, parallel to `rows`. */
  offsets: number[];
  totalHeight: number;
}

/** Flatten sections into rows and their offsets; collapsed groups keep one row. */
export function buildAccordion<T>(
  sections: readonly AccordionSection<T>[],
  keyOf: (item: T) => string,
): AccordionLayout<T> {
  const rows: AccordionRow<T>[] = [];
  const offsets: number[] = [];
  let top = 0;
  for (const section of sections) {
    rows.push({ kind: "group", key: section.key, sectionKey: section.key, height: PROJECT_GROUP_ROW_HEIGHT });
    offsets.push(top);
    top += PROJECT_GROUP_ROW_HEIGHT;
    if (!section.expanded) continue;
    for (const item of section.items) {
      rows.push({
        kind: "item",
        key: keyOf(item),
        sectionKey: section.key,
        height: SESSION_ROW_HEIGHT,
        item,
      });
      offsets.push(top);
      top += SESSION_ROW_HEIGHT;
    }
  }
  return { rows, offsets, totalHeight: top };
}

/** Index of the row rendered for a key, or -1. Used to keep a focused row mounted. */
export function accordionRowIndex<T>(layout: AccordionLayout<T>, key: string | null | undefined): number {
  if (!key) return -1;
  return layout.rows.findIndex((row) => row.key === key);
}

/** First row index whose top offset is greater than `target`. */
function upperBound(offsets: readonly number[], target: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Rows to mount for the current scroll window: everything visible plus an
 * overscan on both sides, and the focused row even when it scrolled out (an
 * inline rename must not be discarded by scrolling).
 */
export function accordionVisibleIndices<T>(
  layout: AccordionLayout<T>,
  scrollTop: number,
  viewportHeight: number,
  focusedIndex = -1,
  overscan = DEFAULT_OVERSCAN,
): number[] {
  const count = layout.rows.length;
  if (count === 0) return [];
  const viewport = viewportHeight || 600;
  const firstVisible = Math.max(0, upperBound(layout.offsets, scrollTop) - 1);
  const endVisible = upperBound(layout.offsets, scrollTop + viewport);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, endVisible + overscan);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
  if (focusedIndex >= 0 && focusedIndex < count && !indices.includes(focusedIndex)) {
    if (focusedIndex < start) indices.unshift(focusedIndex);
    else indices.push(focusedIndex);
  }
  return indices;
}

/** Raw stored value is a JSON array of project keys; anything else is ignored. */
export function parseExpandedProjectKeys(raw: string | null): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of parsed) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    keys.push(value);
  }
  return keys;
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

export function loadExpandedProjectKeys(): string[] {
  const storage = getBrowserStorage();
  if (!storage) return [];
  try {
    return parseExpandedProjectKeys(storage.getItem(EXPANDED_PROJECTS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveExpandedProjectKeys(keys: readonly string[]): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...new Set(keys)]));
  } catch {
    // Quota or a private-mode store: the accordion still works, it just forgets.
  }
}

/** Add or remove one key, keeping the list order stable. */
export function toggleExpandedProjectKey(keys: readonly string[], key: string, expanded: boolean): string[] {
  const without = keys.filter((value) => value !== key);
  return expanded ? [...without, key] : without;
}

export interface ProjectGroup<T> {
  key: string;
  /** Original project path, used for display and filesystem operations. */
  root: string;
  /** Session families of this project, most recent first. */
  items: T[];
}

/**
 * Every project known to the session catalogue plus the currently selected
 * one, ordered by recent activity. A project with no sessions (just opened
 * through the directory picker) still gets a group so its conversations can be
 * started from the sidebar.
 */
export function listProjectGroups<T>(
  sessions: readonly SessionInfo[],
  itemsByProjectKey: ReadonlyMap<string, T[]>,
  current: RecentProject | null,
): ProjectGroup<T>[] {
  const projects = getRecentProjects(sessions);
  const groups = projects.map((project) => ({
    key: project.key,
    root: project.root,
    items: itemsByProjectKey.get(project.key) ?? [],
  }));
  if (current && !projects.some((project) => project.key === current.key)) {
    groups.unshift({
      key: current.key,
      root: current.root,
      items: itemsByProjectKey.get(current.key) ?? [],
    });
  }
  return groups;
}
