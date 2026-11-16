> **Superseded** by `SCREEN_MODEL.md` (the thread). Kept for the record of
> the panel layouts that were rejected as a rearrangement of conventional
> regions.

# RustGit · ShrenixCodes wireframes

Structural wireframes for the three core workspaces, drawn before
implementation. Widths are for a 1280 px window; `│` is a 1 px boundary used
only where space alone cannot separate, `·` marks negative space. Every
element shown is backed by a real command in `integration/API_CONTRACT.md`.

## Shared frame

```
┌──┬────────────────────────────────────────────────────────────────────────┐
│◇ │ orbital-demo ▾   ● main ─ 2↑ 1↓   4 changed            [actions of the │  ← ridge (52 px quiet / 44 deep)
│  │                                                        workspace]  ⟳   │
│▣ ├────────────────────────────────────────────────────────────────────────┤
│◷ │                                                                        │
│⎇ │                     workspace (own layout per task)                    │
│  │                                                                        │
│  │                                                                        │
│⚙ ├────────────────────────────────────────────────────────────────────────┤
│◐ │ ⟳ fetch origin 4s · 2 operations · ✕ 1 failed               activity ▴ │  ← operation shelf (26 px)
└──┴────────────────────────────────────────────────────────────────────────┘
 48 px rail: mark ◇, workspaces, settings ⚙, personality ◐ (quiet / deep)
```

- The **rail** is navigation only (icons + tooltips with shortcuts). It
  carries no repository data, so it can stay 48 px.
- The **ridge** is the repository context: name (opens the switcher), the
  branch path `● main ─ 2↑ 1↓` (same visual language as the graph), working
  tree state, then the current workspace's actions at the right. It replaces
  per-page headers and the repository block that used to sit in a sidebar.
- The **operation shelf** is the persistent operation center: running
  operation with elapsed time, counts, failures, and an expandable activity
  panel listing real Git commands (`command_history`) and UI operations.

## History — chronological graph workspace

```
├─────────────┬──────────────────────────────────────────┬───────────────────┤
│ — strand     │ ◷ lineage      search…   from–to   ⊖ ⊕ │ — commit           │
│ ● main 2↑   │                                          │ 1a2b3c4  ⎘        │
│   feature    │ ◌ ⎇main  Local work not pushed  ada  2m │                   │
│   fix/menu 1↓│ ●        Prepare 0.2 release    ada  1h │ Merge branch      │
│ · remotes 3  │ ●●╮      Merge 'feature/graph'  ada  1h │ 'feature/graph'   │
│ · tags 2     │ │ ●  ↗origin/feature Draw edges ada  2h │                   │
│              │ │ ●      Add lane layout      ada  2h │ ada · 1 h ago     │
│              │ ● │      Document the project ada  3h │ parents 6401ae5   │
│              │ ●─╯ ◇v0.1 Initial commit     ada  1d │         19de60b   │
│              │                                          │ — files 1  +2 −0  │
│              │                                          │ A graph.rs        │
├─────────────┴──────────────────────────────────────────┴───────────────────┤
  180 px                        flexible                         300 px
```

- **Strand** (left, narrow, collapsible): the current branch first, other
  local branches with ahead/behind marks, remotes and tags folded. Choosing
  one filters the lineage to that branch's ancestry; choosing it again
  returns to all refs. It doubles as the branch-relationship view inside
  History.
- **Lineage** (centre, widest): one commit per row, newest first, the graph
  on the left of each row. HEAD is the open node `◌`, commits are points,
  merges are paired points, labels are mono text with a glyph (no pills).
  Zoom `⊖ ⊕` changes row height and lane spacing; the graph pans when wider
  than its column. Search and dates sit in the lineage's own header line.
- **Commit inspector** (right): full id, message, people, parents (each
  navigates), changed files with counts. It shows only the selected commit;
  nothing about a commit is repeated in the row beyond one line.

Workflow improvement: you read history top to bottom without a table frame,
branch context is one click away on the left instead of in a dropdown, and
details never push the graph narrower than the inspector's fixed width.

## Changes — integrated navigator, diff canvas, contextual inspector

```
├──────────────────────────┬───────────────────────────────────┬───────────────┤
│ filter…        ◧ index ◨ │ src/lib.rs        unified · split │ — next commit  │
│                 tree     │                                   │ 3 files +12 −4 │
│ — conflicts 1            │ — staged                          │                │
│ ! conflict.txt     ·  !  │ @@ -1,3 +1,4 @@        [unstage]  │ summary        │
│ — changes 6              │   fn a() {}                       │ ______________ │
│ M src/lib.rs       ●  ●  │ + fn b() {}                       │ description    │
│ M README.md        ·  ●  │                                   │ ______________ │
│ A src/new.rs       ●  ·  │ — not staged                      │                │
│ D old.rs           ·  ●  │ @@ -2,3 +2,4 @@  [stage] [discard] │ ☐ amend        │
│ — untracked 2            │   fn b() {}                       │ ada <a@x>      │
│ ? notes.md         ·  ●  │ + fn c() {}                       │                │
│                          │                                   │ [ commit ⌃⏎ ] │
├──────────────────────────┴───────────────────────────────────┴───────────────┤
        300 px                        flexible                       280 px
```

- **Integrated navigator** (left): each changed file appears **once**, with
  two state cells, `index` and `tree`, exactly like Git's `XY` status. A
  filled cell means changes on that side; a file staged in part shows both
  cells filled, so partial staging is visible on one line without listing
  the file twice. Clicking the index cell (or `Space`) stages or unstages the
  whole file; the conflicts, changes and untracked groups keep the cases
  that behave differently apart.
- **Diff canvas** (centre): the selected file's staged section above its
  not-staged section, each with its own hunk actions; lines are selectable
  for line staging. Unified or split; whitespace toggle. Only visible lines
  are mounted.
- **Contextual inspector** (right): with files staged it is the composer for
  the next commit (summary, description, amend, identity, totals,
  `Ctrl+Enter`); hook output and errors appear here, under the message they
  belong to.

Workflow improvement: one row per file ends the "is this file in both lists?"
question; staging happens next to the file or next to the hunk you are
reading; the commit message is written beside the totals it describes and
never competes with the file list for height.

## Branches — relationship workspace

```
├──────────────────────────┬────────────────────────────────────┬──────────────┤
│ new branch…           +  │ feature/graph                      │ — branch      │
│ — current                │ ─ origin/feature/graph  2↑ 0↓      │ feature/graph │
│ ● main     origin 2↑ 1↓ │                                    │ upstream      │
│ — local 3                │ ◌ Draw edges between lanes    2h   │ origin/feat…  │
│   feature/graph    2↑   │ ● Add lane layout             2h   │ last commit   │
│   fix/menu      gone    │ ● Initial commit  (shared)    1d   │ 2 h ago       │
│ — remote 4               │                                    │               │
│   origin/main            │                                    │ [switch]      │
│   origin/feature/graph   │                                    │ [merge into   │
│ — tags 2                 │                                    │   main]       │
│   v0.1.0                 │                                    │ [rebase main  │
│                          │                                    │  onto this]   │
│                          │                                    │ rename · del  │
├──────────────────────────┴────────────────────────────────────┴──────────────┤
        280 px                          flexible                      260 px
```

- **Branch navigator** (left): current branch pinned with its upstream path,
  then local, remote and tags; each row states its relationship in words
  where Git gives one (`2↑`, `1↓`, `gone`, `no upstream`). Create from the
  filter line.
- **Branch lineage** (centre): the selected branch's recent commits from
  `log_page` (revision = the branch), drawn with the same graph, so you see
  what the branch contains before you act on it.
- **Inspector** (right): upstream, ahead/behind, last commit, and the
  operations that apply to *this* branch relative to the current one
  (switch, merge into current, rebase, rename, delete, set upstream). Each
  destructive or history-changing action opens a confirmation that states
  its effect; errors from the backend (`would_overwrite_changes` with paths,
  `branch_not_fully_merged`) are shown with the recovery option.

Workflow improvement: you inspect a branch's commits and its relation to
its upstream *before* switching or merging, in one place, and every action
is offered on the object it acts on instead of in a global menu.
