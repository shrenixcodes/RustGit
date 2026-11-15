# RustGit screen model: the thread (proposal, awaiting approval)

Supersedes the panel layouts in `SHRENIXCODES_WIREFRAMES.md`, which only
rearranged the conventional regions (sidebar, pages, file list, central
diff, right inspector). Nothing below assumes those regions exist.

## Starting point: what Git actually is

Git has one structure: a graph of commits, plus a working tree that is the
commit not yet made. "Changes", "History" and "Branches" are not three
places; they are the same graph seen at its loose end, along its length, and
from far away. The interface therefore has **one canvas**, and the user
changes *distance* and *focus*, not pages.

## The model

1. **The thread.** A single vertical canvas: the repository's lineage, newest
   at the top. There is no navigation sidebar, no tab bar, no page per
   feature.
2. **The loose end.** The top of the thread is the working tree, drawn as
   the open node. It summarises what is uncommitted
   (`now · 3 files changed · 1 partly staged`). Its row *is* the commit
   message field: you write the commit where it will appear in history.
   Committing closes the open node into a point in the line.
3. **Unfold in place.** Selecting the loose end, or any commit, unfolds it
   beneath its own row: the files hang off the node as short branches, each
   with its diff inline in one continuous review stream. Staging happens on
   the file's two state marks (index, tree) and on each hunk. There is no
   separate file list, no distant diff panel and no inspector: detail
   appears where its object is.
4. **Semantic zoom, three distances on the same canvas.**
   - *Map* (`Ctrl+-`): only branch heads, forks and merges. Each head states
     its relationship (ahead/behind, upstream gone, current). Selecting a
     head unfolds its operations inline: switch, merge into current, rebase
     onto current, rename, delete, set upstream, publish.
   - *Thread* (`Ctrl+0`): every commit, one row each.
   - *Unfolded* (`Enter` / `Ctrl+=`): the focused node opens.
5. **Go anywhere.** `Ctrl+K` replaces navigation chrome: repositories,
   branches, commits, files, commands and settings by name. The repository
   is a small seal in the corner (name and branch path); it is also the
   switcher.
6. **Operations** run quietly on the bottom edge (the existing shelf), and
   their output unfolds there.

## How each required workflow happens

| Workflow | Where it happens |
| -------- | ---------------- |
| Inspect changes, stage file/hunk/line, discard | The unfolded loose end |
| Commit, amend | The loose end's row (amend re-opens the last point) |
| Browse history, search, filter | The thread; search narrows the thread in place |
| Inspect a commit and its diffs | Unfold that commit |
| Create, switch, rename, delete, merge, rebase branches | The map, on the branch head |
| Compare | Select two nodes or heads; the comparison unfolds between them (needs R-16) |
| Conflicts | The loose end shows conflicted files first; resolving unfolds base / ours / theirs / result |
| Stash, worktrees, remotes | Side threads on the map (stashes hang off the commit they were made on) |
| Settings, repositories | `Ctrl+K`, and the seal |

## What is reused

The working parts built so far are composition-independent and move into
the thread unchanged in behaviour: the incremental lane layout and graph
cells, the paged log and live refresh, the diff model and canvas rows, hunk
and line staging, discard confirmation, the commit composer logic and
drafts, the operation log and command history, tokens and the open node.

## Risks and how they are handled

- **Large change sets:** the unfolded loose end is one virtualised stream;
  files can be folded individually; a file outline appears in the thread
  gutter as ticks you can jump between.
- **Discoverability without chrome:** the seal, the loose end's summary
  and a one-line hint row are always visible; `Ctrl+K` lists every command
  with its shortcut.
- **Accessibility:** the canvas is a tree (nodes, unfolded children) with
  landmarks for the seal, the thread and the shelf; every action has a
  keyboard path and a visible control on focus.
