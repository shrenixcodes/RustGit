# RustGit UI/UX research

Scope: what RustGit should learn from existing Git clients and component
libraries. Observations are tied to concrete Git workflows. Licenses were
checked on 2026-11-15 against each repository's license file through the
GitHub API.

## License summary

| Reference                         | License (verified)           | How RustGit may use it                                   |
| --------------------------------- | ---------------------------- | -------------------------------------------------------- |
| GitHub Desktop (`desktop/desktop`)| MIT                          | Concepts; code reuse possible with notice (none so far)  |
| GitButler (`gitbutlerapp/gitbutler`) | FSL-1.1-MIT (Functional Source License, converts to MIT after two years) | **Concepts only.** No code, assets or branding. A competing Git client is the use FSL restricts. |
| GitUI (`gitui-org/gitui`)         | MIT                          | Concepts                                                 |
| GitTree (`stixez/gittree`)        | MIT                          | Concepts                                                 |
| React Flow (`xyflow/xyflow`)      | MIT                          | Evaluated, not adopted (see below)                       |
| CodeMirror Merge (`codemirror/merge`) | MIT                      | Candidate for the conflict editor (Phase 6)              |
| Pierre Diffs (`pierrecomputer/pierre`, `packages/diffs`) | Apache-2.0 | Evaluated, not adopted for the staging diff         |
| React Git Log (`TomPlum/react-git-log`) | Apache-2.0             | Evaluated, not adopted                                   |
| Radix Primitives                  | MIT                          | Candidate for menus/popovers when needed                 |
| shadcn/ui                         | MIT                          | Pattern reference only (copy-in components)              |
| Lucide                            | ISC                          | In use (`lucide-react`)                                  |
| React Virtuoso (`packages/react-virtuoso`) | MIT (the repository's `message-list` package is commercial) | Not adopted yet |
| react-resizable-panels            | MIT                          | Not adopted; a small splitter is implemented instead     |
| Inter, JetBrains Mono             | SIL OFL 1.1                  | In use, self-hosted with license files                   |

## Git clients

### GitHub Desktop

Does well:

- **Changes → commit is one screen.** The file list has a checkbox per file
  and the commit box sits directly under it, so "pick files, write message,
  commit" never navigates. This is the baseline RustGit must not regress.
- **Plain terminology.** "Undo" for the last commit, "Publish branch" instead
  of `push -u`, "Fetch origin" with a last-fetched time.
- **Safe branch switching.** When switching with local changes it asks
  whether to bring the changes along or stash them on the current branch.

Makes difficult:

- **Staging is hidden.** Desktop has no visible index: checkboxes decide what
  is committed and it stages at commit time. Users who also use the CLI see a
  different state (`git status` shows nothing staged) and cannot leave partial
  staging in place across sessions. Line selection exists, but there is no
  hunk-level action and no view of "what is already in the index".
- **History is a flat list.** No graph, so merges, diverged branches and
  "where did this branch start" are invisible.
- **One repository at a time, one task at a time.** Comparing branches,
  inspecting a commit and looking at local changes are separate modes.
- **Opaque operations.** When a hook or push fails, the dialog shows the
  error text but not the command that ran.

Adopt: single-screen changes+commit, plain labels, safe-switch choices.
Improve: show the real index (staged vs unstaged), hunk and line actions on
both sides, a graph, and visible command records.

### GitButler (concepts only; FSL)

Does well:

- **Operations log with restore points.** Every mutation is recorded with a
  snapshot so it can be reverted. The lesson: users trust a tool that shows
  what it did and how to go back.
- **Stacked/virtual branches** make "several things in progress" concrete.
- **Commit manipulation by direct manipulation** (drag a hunk into a commit,
  squash by dropping).

Makes difficult:

- The virtual-branch model diverges from plain Git. A repository used with
  GitButler does not look the same from the CLI, and users must learn a new
  mental model. RustGit's rule is the opposite: **the UI must always reflect
  what `git status`/`git log` would show.**

Adopt: an operation history that lists real commands and their results;
offer undo only where Git provides a safe inverse (e.g. unstage after stage,
`reset --soft HEAD~1` after a commit that has not been pushed, reflog-based
recovery hints). Do not adopt virtual branches.

### GitUI

Does well:

- **Keyboard-first with context-sensitive hints.** The bottom bar lists the
  keys valid for the focused panel, so shortcuts are discoverable without a
  manual.
- **Hunk staging from the diff panel** with a single key; the file list and
  the diff are always visible together.
- **Fast on large repositories**: work is asynchronous and the UI never
  blocks on `git status`.

Makes difficult:

- Terminal constraints: no side-by-side diff at narrow widths, limited mouse
  use, no graph lanes beyond simple characters.

Adopt: visible shortcut hints scoped to the focused panel; `s`/`u` style
single-key stage/unstage in the diff; asynchronous everything.

### GitTree

Does well:

- **The graph as the main object**: lanes with consistent colors, zoom, a
  minimap and search over the visible history. A browser-based visualizer
  shows that a high-contrast dark canvas makes topology readable.

Makes difficult:

- It is a viewer: no staging, commits or operations, so the graph is not
  connected to any action.

Adopt: lane coloring, minimap for long histories, search that highlights
rather than hides. Improve: every node is actionable (inspect, compare,
checkout, cherry-pick) and the graph reflects refs updated by RustGit's own
operations immediately.

### GitKraken, Linear, Raycast (design references)

- GitKraken: graph-centric layout with commit details to the right is the
  closest precedent for RustGit's History view. Its heavy toolbars and modal
  flows are what RustGit avoids.
- Linear: dense lists, quiet chrome, every action reachable from the
  keyboard and from a command menu; selection state drives a side panel.
- Raycast: the command palette as the primary launcher, with fuzzy matching
  and actions that accept arguments.

## Component and rendering references

### Commit graph: React Flow vs. custom renderer

React Flow is a node editor: nodes are freely positioned objects, edges are
routed between handles, and layout is the application's problem. A commit
graph is a different structure:

- Rows are fixed: one commit per row, ordered by Git (topological/date).
- Columns ("lanes") are assigned by a sweep over that order, so the layout is
  O(n) and incremental when more history is appended.
- Edges are vertical runs with short diagonal joins, never routed paths.
- Nodes are not draggable.

React Flow's model (every node a React component with measured dimensions)
also scales poorly to thousands of commits without heavy virtualization.
**Decision:** a custom lane-assignment algorithm (pure TypeScript, unit
tested) and a row-virtualized SVG renderer. React Flow stays a candidate for
a small branch-topology diagram if one is ever needed.

React Git Log (Apache-2.0) renders a graph plus table, but it computes layout
over the whole log it is given and does not target lazy paging. Not adopted;
its visual approach (graph column aligned with table rows) matches ours.

### Diff rendering: Pierre Diffs vs. custom

Pierre Diffs renders unified and split diffs with syntax highlighting from a
patch string. RustGit's staging diff needs per-line selection, per-hunk
stage/unstage buttons and line identities that map back to a patch we
generate for `git apply --cached`. That requires owning the line model.
**Decision:** parse `git diff` output in Rust into hunks and lines, render
with a custom virtualized component. Pierre stays a candidate for read-only
commit diffs where syntax highlighting matters more than interaction.

### Conflict editor: CodeMirror Merge

MIT, maintained by the CodeMirror author, supports two-way and unified merge
views and a real editor for the result. It is the planned foundation for
Phase 6; adoption will be recorded when it lands.

### Primitives

- Radix Primitives (MIT) give accessible menus, popovers and tooltips. They
  will be added when context menus land; until then RustGit uses native
  `<dialog>` (focus trap, Escape, `aria-modal` are built in) and buttons.
- shadcn/ui is a copy-in pattern library over Radix and Tailwind; used as a
  reference for component APIs, not installed.

### Virtualization

File lists and diffs have fixed row heights, so a ~60-line windowing hook
covers them without a dependency. React Virtuoso (MIT) remains the fallback
if variable-height rows (e.g. wrapped commit messages) become necessary.

## What deserves an original implementation

1. **Index-aware diff.** Show staged and unstaged diffs as two separate,
   labelled sections for a partially staged file, with stage/unstage at hunk
   and line level on each. No reference shows both sides at once.
2. **Command records attached to operations.** Every operation in the shelf
   links to the exact (redacted) Git commands it ran, exit codes and stderr.
3. **Commit graph with lazy lane layout** that pages history from the
   backend and never needs the full log in the frontend.
4. **Operation previews** for merge/rebase computed from `git merge-tree`
   and `rev-list` (Phase 5), labelled as estimates.
