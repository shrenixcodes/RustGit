# RustGit UX acceptance

Status per required workflow. **Pass** = verified in the native app against
a real repository (or by component tests where noted); **Partial**;
**Blocked (R-n)** = needs a backend capability; **Not started**.

| #  | Workflow                         | Status            | Evidence / notes                                            |
| -- | -------------------------------- | ----------------- | ----------------------------------------------------------- |
| 1  | Open repository                  | Pass              | Native smoke test, 5 consecutive passes on 2026-11-15       |
| 2  | Switch repository                | Pass (tests)      | Rail switcher with filter and keyboard; `NavRail.test.tsx`  |
| 3  | Inspect changed files            | Pass (tests)      | Grouped tree, partial markers, inspector; `ChangesView.test.tsx` |
| 4  | Stage a file                     | Pass              | Native QA: Space on a file, git status checked              |
| 5  | Stage a hunk                     | Pass              | Native QA: hunk and single line, git diff --cached checked  |
| 6  | Unstage a hunk                   | Pass              | Native QA (changes-qa), git diff --cached checked           |
| 7  | Commit staged changes            | Pass              | Native QA: from the loose end row, git log checked          |
| 8  | Amend a commit                   | Pass              | Native QA: message prefilled, parent unchanged              |
| 9  | Create and switch branches       | Pass              | Native QA on the map; refused switch names blocking file    |
| 10 | Compare branches                 | Blocked (R-16)    | Needs a range comparison from the backend                   |
| 11 | Browse commit graph              | Pass              | Native QA 2026-11-16, incl. 4 636-commit repository (U-9)   |
| 12 | Search commits                   | Pass              | Native QA: message search; author and id search in tests    |
| 13 | Fetch                            | Blocked (R-13)    |                                                             |
| 14 | Pull                             | Blocked (R-13)    |                                                             |
| 15 | Push                             | Blocked (R-13)    |                                                             |
| 16 | Stash                            | Blocked           | Defined in contract C-2, not implemented yet                |
| 17 | Restore stash                    | Blocked           | Defined in contract C-2, not implemented yet                |
| 18 | Resolve merge conflict           | Blocked (R-14)    | Conflicts are listed and explained                          |
| 19 | Inspect operation history        | Pass              | Activity panel: operations and Git commands (command_history) |
| 20 | Use command palette              | Pass              | Native QA: palette → map → switch                           |
| 21 | Navigate with keyboard only      | Partial           | Rail, switcher, file tree, splitters, settings; see `INTERACTION_SPEC.md` |
| 22 | Reduced window sizes             | Partial           | Rail collapses < 1100 px, inspector overlays < 1240 px      |
| 23 | Switch light and dark themes     | Pass              | Contrast test; native smoke test                            |

Final acceptance criteria from the specification that are not yet met are
listed in `UI_PROGRESS.md` under "Open".
