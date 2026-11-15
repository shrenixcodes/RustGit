> **Composition superseded** by `SCREEN_MODEL.md`: S-1 (rail and ridge),
> S-2 (navigator, canvas, inspector) and S-3 (strand) were replaced by one
> canvas. S-4 (personalities), S-5 (metadata on demand) and S-6 still apply.

# RustGit · ShrenixCodes UX decisions

Each decision states what changes compared with the previous ("Orbital")
interface and why, in terms of a Git workflow. Functional behaviour of
every existing feature is preserved; see `SHRENIXCODES_VISUAL_QA.md` for
the before/after verification.

## S-1 The repository is the frame, not a page

Before: a 216 px labelled sidebar with a repository switcher on top, and
every section repeating a page header. This is the conventional client
layout (sidebar + page + header) the brief asks to leave behind.

After:
- **Rail** (48 px, icons only, tooltips with shortcuts): the mark, then the
  workspaces, then settings and the workspace personality at the foot. It
  never shows labels, so it never competes with repository content.
- **Ridge** (one line across the workspace): the repository's name, its
  branch path (`● main ─ 2↑ 1↓`), the working tree state, and on the right
  the actions of the current workspace. Clicking the name opens the
  repository switcher (`Ctrl+P`). There are no per-page headers; the rail
  icon already says where you are.
- **Shelf** stays at the bottom for operations, quieter (no repeated
  repository information, which now lives in the ridge).

Workflow served: switching repository and knowing which branch you are on
happen in the same place you are looking, at the top of the work.

## S-2 Changes follows Git's own direction: working tree → next commit

Before: file list on the left, diff in the middle, inspector on the right,
with staged and unstaged as groups in one list. That is GitHub Desktop's
composition with groups added.

After (revised by the structural brief: integrated navigator, dedicated
diff canvas, contextual inspector; see `SHRENIXCODES_WIREFRAMES.md`):

1. **Integrated navigator** (left): every changed file appears once, with
   two state cells, *index* and *tree*, mirroring Git's `XY` status. A file
   staged in part fills both cells, so partial staging is visible on one
   line. The index cell (or `Space`) stages or unstages the whole file.
2. **Diff canvas** (centre, widest): the staged section above the
   not-staged section of the selected file, each with its own hunk and line
   actions.
3. **Contextual inspector** (right): the composer for the next commit
   (summary, description, amend, identity, totals) and the place where hook
   output and commit errors appear.

The earlier idea of separate "working tree" and "next commit" columns was
dropped: listing a partially staged file twice is exactly the ambiguity the
two-cell row removes.

## S-3 History is lineage first

Before: a cyan "instrument" graph with pill labels in a table.

After:
- Thin lanes in muted hues, solid point nodes, merges as paired points,
  HEAD as the open node (see design system §6).
- Labels are plain mono text with a glyph (no pills): `⎇ main` in sage when
  current, remote names in indigo, tags in clay.
- **Branch strand** on the left of History: local branches with ahead/behind
  marks, remote branches and tags, collapsed by default. Selecting one
  filters the lineage to that branch; it replaces a separate filter control
  and is the compact branch-relationship view the brief asks for.
- **Zoom**: three scales (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`) change row height
  and lane spacing; the graph pans horizontally when wider than its column.

## S-4 Two workspace personalities

Quiet (default): standard surfaces, 30 px rows, generous margins, for daily
work. Deep: darker surfaces in the dark theme, 24 px rows, denser columns,
for history and investigation. One toggle at the foot of the rail
(`Ctrl+Shift+D`), remembered. They replace the separate density setting.

## S-5 Metadata on demand (Yūgen)

Lists show one line of essentials: name or summary, a status glyph, a short
count. Emails, full hashes, upstream names, committer details and paths of
renamed files appear on selection (inspector, right column) or as tooltips.

## S-6 What stays the same

Keyboard shortcuts, accessible names (the native smoke test relies on
"Changes", "Settings", "Open <name>", "Refresh", "Light"), real-data-only
rule, virtualised lists, incremental graph layout, live refresh through
`repository-changed`, dark default.
