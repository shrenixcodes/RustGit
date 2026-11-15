# RustGit UX acceptance

Status per required workflow. **Pass** = verified in the native app against
a real repository (or by component tests where noted); **Partial**;
**Blocked (R-n)** = needs a backend capability; **Not started**.

| #  | Workflow                         | Status            | Evidence / notes                                            |
| -- | -------------------------------- | ----------------- | ----------------------------------------------------------- |
| 1  | Open repository                  | Pass              | Native smoke test, 5 consecutive passes on 2026-11-15       |
| 2  | Switch repository                | Pass (tests)      | Rail switcher with filter and keyboard; `NavRail.test.tsx`  |
| 3  | Inspect changed files            | Pass (tests)      | Grouped tree, partial markers, inspector; `ChangesView.test.tsx` |
| 4  | Stage a file                     | Not started       | Backend ready (C-1 `stage_paths`)                           |
| 5  | Stage a hunk                     | Not started       | Backend ready (C-1 `file_diff`, `apply_hunk`)               |
| 6  | Unstage a hunk                   | Not started       | Backend ready (C-1 `apply_hunk`)                            |
| 7  | Commit staged changes            | Not started       | Backend ready (C-1 `create_commit`, C-2 `commit_context`)   |
| 8  | Amend a commit                   | Not started       | Backend ready (C-1, C-2)                                    |
| 9  | Create and switch branches       | Blocked (R-9, R-11)|                                                            |
| 10 | Compare branches                 | Blocked (R-8, R-9)|                                                             |
| 11 | Browse commit graph              | Blocked (R-8, R-9)| Lane layout engine done and tested                          |
| 12 | Search commits                   | Blocked (R-8)     |                                                             |
| 13 | Fetch                            | Blocked (R-13)    |                                                             |
| 14 | Pull                             | Blocked (R-13)    |                                                             |
| 15 | Push                             | Blocked (R-13)    |                                                             |
| 16 | Stash                            | Blocked           | Defined in contract C-2, not implemented yet                |
| 17 | Restore stash                    | Blocked           | Defined in contract C-2, not implemented yet                |
| 18 | Resolve merge conflict           | Blocked (R-14)    | Conflicts are listed and explained                          |
| 19 | Inspect operation history        | Partial           | App operations with real outcomes; Git commands need R-1    |
| 20 | Use command palette              | Not started       |                                                             |
| 21 | Navigate with keyboard only      | Partial           | Rail, switcher, file tree, splitters, settings; see `INTERACTION_SPEC.md` |
| 22 | Reduced window sizes             | Partial           | Rail collapses < 1100 px, inspector overlays < 1240 px      |
| 23 | Switch light and dark themes     | Pass              | Contrast test; native smoke test                            |

Final acceptance criteria from the specification that are not yet met are
listed in `UI_PROGRESS.md` under "Open".
