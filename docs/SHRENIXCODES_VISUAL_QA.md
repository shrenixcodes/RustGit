# RustGit · ShrenixCodes visual QA

Real application screenshots, Windows 11, WebView2, debug build of branch
`worktree-ui-orbital`, 1280×800, dark and light themes. Repositories were
created with the Git CLI for each run (merges, tags, remote-tracking
branches, partial staging, untracked files) and every UI action was checked
against Git. Screenshots are kept outside the repository (scratch QA runs).

## Before and after

| Aspect | Before (Orbital, panels) | After (the thread) |
| ------ | ------------------------ | ------------------ |
| Composition | Labelled sidebar → page header → file list, diff, right inspector; History and Branches as separate pages | One canvas: seal, thread, shelf. No sidebar, tabs, page headers or inspector |
| Working tree | A page ("Changes") with groups in a list | The loose end: the open node at the top of history; its row is the commit summary |
| Partial staging | File listed in two groups with a marker | One row, two marks (index, tree), "partly staged" in words |
| History | A table with a graph column | The canvas itself; commits unfold in place |
| Branches | A strand list and a separate (planned) page | The map: the same canvas zoomed out, operations on the head |
| Palette | Cyan, violet, amber "instrument" | Sage, moss, clay, indigo on warm dark surfaces; no grain or textures |
| Labels | Uppercase tracked labels, pills | Lowercase mono labels with a hairline; glyph + text references |
| HEAD | Filled cyan node with halo | Solid clay point; the open node is reserved for uncommitted work |

## Checks

| Check | Result |
| ----- | ------ |
| Contrast | `tokens.test.ts`: every text token ≥ 4.5:1, graphics ≥ 3:1, on all surfaces of dark, deep and light |
| Two open rings (HEAD and loose end) | Found in QA; HEAD changed to a solid point |
| Lanes interrupted by an unfolded commit | Found in QA; folds now continue every passing lane in its colour |
| Commit fold height | Found in QA (large empty fold for one file); now sized from the commit's file count |
| Map condensation | 6 commits → 4 nodes with "n commits below folded" annotations |
| Branch switch refused by Git | Fold says "Nothing changed" and names the blocking file; shelf records the failure |
| Console errors / application log errors | None in any run |
| Native smoke test (core session's, updated selectors) | Passes |

## Not yet verified

Narrow windows (below 1100 px), Windows display scaling above 100 %,
screen reader pass, large-history performance of the map beyond 3 000
commits, and light theme of every fold.
