import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PROJECT_GROUP_ROW_HEIGHT,
  SESSION_ROW_HEIGHT,
  accordionRowIndex,
  accordionVisibleIndices,
  buildAccordion,
  listProjectGroups,
  parseExpandedProjectKeys,
  toggleExpandedProjectKey,
} = await jiti.import("./project-accordion.ts");

const sections = [
  { key: "a", expanded: true, items: [{ id: "a1" }, { id: "a2" }] },
  { key: "b", expanded: false, items: [{ id: "b1" }] },
  { key: "c", expanded: true, items: [] },
];
const layout = buildAccordion(sections, (item) => item.id);

test("an expanded group contributes a header plus one row per conversation", () => {
  assert.deepEqual(layout.rows.map((row) => row.key), ["a", "a1", "a2", "b", "c"]);
  assert.deepEqual(layout.rows.map((row) => row.kind), ["group", "item", "item", "group", "group"]);
  assert.deepEqual(layout.offsets, [0, 34, 88, 142, 176]);
  assert.equal(
    layout.totalHeight,
    PROJECT_GROUP_ROW_HEIGHT * 3 + SESSION_ROW_HEIGHT * 2,
  );
});

test("a collapsed group keeps only its header row", () => {
  assert.equal(layout.rows.filter((row) => row.sectionKey === "b").length, 1);
  assert.equal(layout.rows.find((row) => row.key === "b1"), undefined);
});

test("an empty project still shows its header", () => {
  assert.equal(layout.rows.filter((row) => row.sectionKey === "c").length, 1);
});

test("rows know which group they belong to", () => {
  assert.deepEqual(layout.rows.map((row) => row.sectionKey), ["a", "a", "a", "b", "c"]);
  assert.equal(layout.rows[1].item.id, "a1");
});

test("a row index is found by the key the list focuses", () => {
  assert.equal(accordionRowIndex(layout, "a2"), 2);
  assert.equal(accordionRowIndex(layout, "b"), 3);
  assert.equal(accordionRowIndex(layout, "missing"), -1);
  assert.equal(accordionRowIndex(layout, null), -1);
});

test("the window mounts every row the viewport shows", () => {
  const indices = accordionVisibleIndices(layout, 88, SESSION_ROW_HEIGHT * 2, -1, 0);
  assert.deepEqual(indices, [2, 3, 4]);
  for (const index of indices) {
    assert.ok(layout.offsets[index] < 88 + SESSION_ROW_HEIGHT * 2);
  }
  assert.ok(!indices.includes(0));
});

test("the window overscans on both sides but stays inside the list", () => {
  const indices = accordionVisibleIndices(layout, 0, 100, -1, 2);
  assert.deepEqual(indices, [0, 1, 2, 3, 4]);
  const atEnd = accordionVisibleIndices(layout, layout.totalHeight, 100, -1, 2);
  assert.deepEqual(atEnd, [2, 3, 4]);
});

test("a focused row stays mounted when it scrolled out of view", () => {
  const below = accordionVisibleIndices(layout, 0, 60, 4, 0);
  assert.deepEqual(below, [0, 1, 4]);
  const above = accordionVisibleIndices(layout, layout.totalHeight, 60, 0, 0);
  assert.deepEqual(above, [0, 4]);
});

test("an empty accordion and an unmeasured viewport are both tolerated", () => {
  const empty = buildAccordion([], (item) => item.id);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.offsets, []);
  assert.equal(empty.totalHeight, 0);
  assert.deepEqual(accordionVisibleIndices(empty, 500, 400), []);
  // Before the pane is measured, viewportHeight is 0 and must still window.
  assert.ok(accordionVisibleIndices(layout, 0, 0).length >= 4);
});

test("stored open groups survive a reload and reject anything else", () => {
  assert.deepEqual(parseExpandedProjectKeys('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseExpandedProjectKeys('["a","a",7,null,"b"]'), ["a", "b"]);
  assert.deepEqual(parseExpandedProjectKeys("not json"), []);
  assert.deepEqual(parseExpandedProjectKeys('{"a":1}'), []);
  assert.deepEqual(parseExpandedProjectKeys(""), []);
  assert.deepEqual(parseExpandedProjectKeys(null), []);
});

test("toggling a group keeps the other open groups in order", () => {
  assert.deepEqual(toggleExpandedProjectKey(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(toggleExpandedProjectKey(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(toggleExpandedProjectKey(["a"], "a", true), ["a"]);
});

test("groups follow recent activity and include a project with no sessions", () => {
  const sessions = [
    { id: "s1", cwd: "/work/one", modified: "2026-01-02T00:00:00.000Z" },
    { id: "s2", cwd: "/work/two", modified: "2026-01-05T00:00:00.000Z" },
  ];
  const items = new Map([["/work/two", [{ id: "s2" }]]]);
  const groups = listProjectGroups(sessions, items, { key: "/work/fresh", root: "/work/fresh" });
  assert.deepEqual(groups.map((group) => group.key), ["/work/fresh", "/work/two", "/work/one"]);
  assert.deepEqual(groups[0].items, []);
  assert.deepEqual(groups[1].items, [{ id: "s2" }]);
  assert.deepEqual(listProjectGroups(sessions, new Map(), null).map((group) => group.key), ["/work/two", "/work/one"]);
});
