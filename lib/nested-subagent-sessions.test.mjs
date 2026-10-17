import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  findNestedSessionPathById,
  nestedSubagentRelation,
  nestedSubagentSessionFiles,
  NESTED_SUBAGENT_PROFILE,
} = await jiti.import("./nested-subagent-sessions.ts");

// The layout one real pi-subagents run left on disk: the parent session's own
// file, and the run below a directory named after it.
const PARENT_DIR = "2026-10-05T18-24-29-471Z_01a10d4f-651f-7588-bfba-b972e2819c44";
const PARENT_SESSION_ID = "01a10d4f-651f-7588-bfba-b972e2819c44";
const FIRST_RUN_ID = "07d321a0-bf01-4c99-be99-ce82700258ce";
const SECOND_RUN_ID = "8efcf15e-0245-4aaa-8f15-6b0fb3597d53";
const THIRD_RUN_ID = "28d13570-299c-46af-abf2-3a3d3dda6ced";
const FIRST_RUN_SESSION_ID = "01a1409a-d058-703c-b292-cab146680199";
const SECOND_RUN_SESSION_ID = "01a140a8-d882-726c-addb-4b70ea6b33aa";

function sessionHeader(id) {
  return `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-10-15T17:27:30.136Z",
    cwd: "/tmp/project",
  })}\n`;
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-nested-subagent-"));
  const project = join(root, "sessions", "--F--documents-project--");
  mkdirSync(project, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  function writeParentFile(name = PARENT_DIR) {
    writeFileSync(join(project, `${name}.jsonl`), sessionHeader(PARENT_SESSION_ID));
  }

  function writeNestedRun({ parentDir = PARENT_DIR, runId, attempt = "run-0", id, name = "session.jsonl" }) {
    const dir = join(project, parentDir, runId, attempt);
    if (name === null) {
      // A run directory that holds no session file at all.
      mkdirSync(dir, { recursive: true });
      return dir;
    }
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, name);
    writeFileSync(filePath, sessionHeader(id));
    return filePath;
  }

  return { root, project, writeParentFile, writeNestedRun };
}

// The header read lib/session-reader.ts passes in, without loading that module
// (and the SDK it pulls in) for a layout test.
function readHeader(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8").split("\n")[0]);
  } catch {
    return null;
  }
}

test("lists a run's nested session under the parent session's own directory", async (t) => {
  const { project, writeParentFile, writeNestedRun } = fixture(t);
  writeParentFile();
  const firstPath = writeNestedRun({ runId: FIRST_RUN_ID, id: FIRST_RUN_SESSION_ID });
  const secondPath = writeNestedRun({ runId: SECOND_RUN_ID, attempt: "run-1", id: SECOND_RUN_SESSION_ID });

  const found = await nestedSubagentSessionFiles(project);

  // Sorted by path, whichever order the directory read returned them in.
  assert.deepEqual(found, [
    { filePath: firstPath, parentSessionId: PARENT_SESSION_ID, runId: FIRST_RUN_ID },
    { filePath: secondPath, parentSessionId: PARENT_SESSION_ID, runId: SECOND_RUN_ID },
  ]);
  assert.deepEqual(nestedSubagentRelation(firstPath), {
    kind: "subagent",
    parentSessionId: PARENT_SESSION_ID,
    profile: NESTED_SUBAGENT_PROFILE,
    description: `Run ${FIRST_RUN_ID.slice(0, 8)}`,
    status: "interrupted",
  });
});

test("ignores a nested run whose parent session's own file is missing", async (t) => {
  const { project, writeNestedRun } = fixture(t);
  const filePath = writeNestedRun({ runId: FIRST_RUN_ID, id: FIRST_RUN_SESSION_ID });

  assert.deepEqual(await nestedSubagentSessionFiles(project), []);
  assert.ok(filePath.startsWith(project));
});

test("ignores a directory that is not named after a session file", async (t) => {
  const { project, writeParentFile, writeNestedRun } = fixture(t);
  writeParentFile();
  writeNestedRun({ runId: FIRST_RUN_ID, id: FIRST_RUN_SESSION_ID, parentDir: "subagent-artifacts" });
  writeNestedRun({ runId: FIRST_RUN_ID, id: FIRST_RUN_SESSION_ID, parentDir: "01a10d4f-651f-7588-bfba-b972e2819c44" });
  writeFileSync(join(project, "subagent-artifacts.jsonl"), sessionHeader("not-a-parent"));

  assert.deepEqual(await nestedSubagentSessionFiles(project), []);
});

test("ignores layouts that are not one run attempt below a parent session", async (t) => {
  const { project, writeParentFile, writeNestedRun } = fixture(t);
  writeParentFile();
  // A directory holding no `session.jsonl` (a run id the extension started, or
  // a `run-N` folder the extension moved on from).
  writeNestedRun({ runId: FIRST_RUN_ID, id: FIRST_RUN_SESSION_ID, name: null });
  // One attempt deeper: not this extension's layout.
  writeNestedRun({ runId: THIRD_RUN_ID, id: FIRST_RUN_SESSION_ID, attempt: join("run-0", "run-0") });
  // The extension's forked-context sessions: a known, deliberate gap.
  const forksDir = join(project, PARENT_DIR, "forks");
  mkdirSync(forksDir, { recursive: true });
  writeFileSync(join(forksDir, `2026-10-06T00-00-00-000Z_${PARENT_SESSION_ID}.jsonl`), sessionHeader("forked"));

  assert.deepEqual(await nestedSubagentSessionFiles(project), []);
});

test("reads the header, never the file name, when resolving one nested session", async (t) => {
  const { project, writeParentFile, writeNestedRun } = fixture(t);
  writeParentFile();
  const filePath = writeNestedRun({ runId: FIRST_RUN_ID, id: FIRST_RUN_SESSION_ID });

  assert.equal(
    await findNestedSessionPathById(FIRST_RUN_SESSION_ID, project, readHeader),
    filePath,
  );
  // The run id names the directories, never the session: a lookup for it matches nothing.
  assert.equal(await findNestedSessionPathById(FIRST_RUN_ID, project, readHeader), null);
  assert.equal(await findNestedSessionPathById("no-such-session", project, readHeader), null);
});

test("rejects a path that is not one nested run's session file", () => {
  const project = join(tmpdir(), "--F--documents-project--");
  const nested = join(project, PARENT_DIR, FIRST_RUN_ID, "run-0", "session.jsonl");

  assert.equal(nestedSubagentRelation(nested)?.parentSessionId, PARENT_SESSION_ID);
  // A flat session file of the project, and one the extension names after the run.
  assert.equal(nestedSubagentRelation(join(project, `${PARENT_DIR}.jsonl`)), null);
  assert.equal(nestedSubagentRelation(join(project, FIRST_RUN_ID, "run-0", "session.jsonl")), null);
  // A run attempt directory that is not `run-<n>`, a different file name, and
  // one level shallower.
  assert.equal(nestedSubagentRelation(join(project, PARENT_DIR, FIRST_RUN_ID, "run-x", "session.jsonl")), null);
  assert.equal(nestedSubagentRelation(join(project, PARENT_DIR, FIRST_RUN_ID, "run-0", "child.jsonl")), null);
  assert.equal(nestedSubagentRelation(join(project, PARENT_DIR, "forks", "session.jsonl")), null);
  assert.equal(nestedSubagentRelation(join(project, PARENT_DIR, "run-0", "session.jsonl")), null);
});
