# 0007 — Conversation tabs and a project accordion (local fork)

## Status

Accepted 2026-10-06. This record describes the fork `pi-web-gui`, which tracks
`agegr/pi-web` and changes only its UI layer.

## Context

pi-web opens one conversation at a time: `AppShell` held a single session in
state, the sidebar listed the sessions of one selected project (a dropdown
switched projects), and a running conversation was only visible while it was
selected. The fork exists for one workflow: supervising several running
conversations across several projects from one browser window, in Chinese, on
one machine.

That workflow needs four things upstream does not offer.

1. Conversations open side by side as tabs, and switching between them must not
   reload history or disturb a run.
2. Every project is visible at once, as collapsible groups with their
   conversations, not one project at a time behind a dropdown.
3. Each conversation shows whether it is 运行中 (running), 完成 (finished) or
   无状态 (idle).
4. An arbitrary directory can be opened as a project and a conversation started
   there.

Constraints fixed before the change: local desktop use only; no new
dependencies; no server-side changes; `~/.pi` data stays as it is; the existing
feature set (files, Git diff, worktrees, models, plugins, skills, terminal,
search, export, branches) keeps working; upstream history and the `upstream`
remote stay, so the diff stays confined to the UI layer.

## Decision

**Four client-side changes, no server change.**

- **Tabs with keep-alive panes** (`components/SessionTabBar.tsx`,
  `lib/session-tabs.ts`). Every open conversation keeps its `ChatWindow`
  mounted; switching only changes which pane is visible
  (`visibility: hidden`, `inert`, `aria-hidden`). A switch therefore never
  refetches history and never remounts a pane mid-run. The tab list is stored in
  `localStorage` (`pi-web:open-session-tabs`) and restored on load; the URL's
  `?session=` chooses the active one. Closing a tab removes the view only,
  middle-click closes, and renaming/order rules stay in one pure module.
- **Per-pane reports instead of one global report** (`AppShell`,
  `paneReportsRef`). Background panes write branch data, system prompt/tools,
  session stats and context usage into their own slot through identity-stable
  callbacks; the visible pane's slot is mirrored into the top-bar panels. This
  is what makes several mounted chats behave like one.
- **Browser-side status** (`lib/session-status.ts`). `running` comes from the
  running set the sidebar already polls (every 2.5 s), `done` is "left the
  running set less than 30 minutes ago", `idle` is everything else. Opening a
  conversation clears its marker, and a bounded timer expires the rest. No new
  endpoint, no new field on the wire.
- **Project accordion** (`lib/project-accordion.ts`, `SessionSidebar`). The
  sidebar lists every project as a group (path, conversation count, activity,
  a "+" that starts a conversation there), each group expandable to its
  conversation rows. Open groups persist in `pi-web:expanded-project-keys`; the
  group of the open conversation is always revealed. Rows are windowed from
  measured offsets because group headers are shorter than conversation rows.

Dropped from the intended scope before implementation: a
"waiting for confirmation" status. The user needed only the three states above,
which removed the only reason to touch `lib/rpc-manager.ts` or an API route.

## Alternatives considered

**Mount only the visible conversation, restore on switch** (upstream behavior,
also the fallback if keep-alive had failed). Smallest memory footprint and no
change to how panes are rendered. Lost because every switch refetches the
transcript and discards transient UI state: scroll position, an open "process
details" block, a half-typed draft's surrounding state. The reading-offset
assertions in `e2e/run.mjs` show how much of that state upstream had to
carefully restore on remount; keeping the pane mounted removes the problem
instead of managing it.

**Split panes side by side.** No tab list to persist, every conversation visible
at once. Rejected by the user: the point is reading one conversation at full
width while watching the others' status, not reading several narrow ones.

**Fork a different project instead of `agegr/pi-web`** (evaluated
`jmfederico/pi-web`, 854 stars, and `samfoy/pi-dashboard`; both were checked in
August 2026). They are different products on different stacks (Fastify + Lit,
respectively an early dashboard) without the Chinese locale and without the
feature set in daily use here — file viewer, Git diff, worktrees, MCP settings,
plugins, skills, terminal. pi-web was also already the installed client, so a
fork keeps the user's data and habits. Those projects remain UX references only.

**Patch upstream and contribute** (issue #910 proposed a cross-project "Active"
view; PR #982 was a small MIT patch that was closed unmerged). An upstream PR
would have to argue for every decision here and could not carry the locale
additions alone. A local fork with a clean UI-layer diff serves the workflow
now; upstream can be merged in later.

**One merged session list across all projects** (the first brief). Simpler to
implement — the sessions are already one array. Replaced at the user's request
by per-project collapsible groups, which keep the project a conversation
belongs to visible without a click and match the Codex / deepseek-harness
layout the user compared against.

**Add dependencies** (a drag-and-drop library for tab reordering, a
virtualization library for the accordion). Rejected: the tab strip uses native
HTML5 drag events and the accordion windows rows with its own offset math, both
covered by tests, so the fork keeps installing the same dependency set.

**Do nothing.** The workflow is supervision of parallel runs; without tabs the
user has to navigate away from a running conversation to watch another one, and
without the accordion every switch costs a dropdown interaction. This is the
reason the fork exists at all.

## Consequences

- Memory grows with the number of mounted conversations. The default cap is five
  tabs (`DEFAULT_MAX_OPEN_SESSION_TABS`, override `pi-web:max-open-tabs`); the
  oldest tab is dropped from the strip when the cap is reached.
- Hidden panes stay in the DOM. They are `inert` and `aria-hidden`, so keyboard
  focus, screen readers and text selection skip them, and the components they
  contain define no DOM ids or label associations — no duplicate-id hazard. Any
  new chat component that adds an `id` must scope it per session.
- Hidden panes keep their `useAgentSession` effects running, so a run keeps
  streaming into a background tab; the stream still closes on the usual
  grace window after the run settles. Because a mounted pane counts as a
  warm/selected session only while visible, no tab holds a session-liveness
  lease forever.
- Sidebar virtualization changed shape: group headers and conversation rows have
  different heights, so a list of only one project no longer windows through
  `getSessionListIndices`. The uniform-height helper stays for compatibility and
  is still tested.
- Selecting a conversation still moves the workspace to that conversation's cwd
  (the file explorer, terminal and Git diff follow it), which now happens as a
  side effect of switching tabs.
- The "done" marker is time based and client-side, so a browser tab left open
  for hours drops markers on its own; a page reload loses them
  (`pi-web:open-session-tabs` stores ids only). The running set, by contrast, is
  always the server's answer.
- Test suite changes: `e2e/session-tabs.mjs` covers tabs, accordion and status
  markers; `e2e/run.mjs` scopes chat assertions to the visible pane
  (`[data-session-pane-active='true']`) and clears stored tabs where it needs a
  single pane, and its reading-offset section now asserts that a background
  pane's pagination does not disturb the shown one.
