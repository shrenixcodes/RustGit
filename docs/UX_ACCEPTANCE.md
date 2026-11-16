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
| 10 | Compare branches                 | Pass              | `compare_revisions` (R-16); native smoke test, `CompareView.test.tsx` |
| 11 | Browse commit graph              | Pass              | Native QA 2026-11-16, incl. 4 636-commit repository (U-9)   |
| 12 | Search commits                   | Pass              | Native QA: message search; author and id search in tests    |
| 13 | Fetch                            | Pass              | Seal sync controls, `Mod+Shift+F`; native smoke test (fetch) |
| 14 | Pull                             | Pass (tests)      | Seal sync controls with mode menu, `Mod+Shift+L`             |
| 15 | Push                             | Pass              | Seal and map, publish with upstream; native smoke test (push) |
| 16 | Stash                            | Pass              | Stash sheet; native smoke test (create/list/pop)            |
| 17 | Restore stash                    | Pass              | Apply / pop / drop in the stash sheet; conflicts reported   |
| 18 | Resolve merge conflict           | Pass              | Native QA: real merge and rebase conflicts, CLI checked     |
| 19 | Inspect operation history        | Pass              | Activity panel: operations and Git commands (command_history) |
| 20 | Use command palette              | Pass              | Native QA: palette → map → switch                           |
| 21 | Navigate with keyboard only      | Partial           | Rail, switcher, file tree, splitters, settings; see `INTERACTION_SPEC.md` |
| 22 | Reduced window sizes             | Partial           | Rail collapses < 1100 px, inspector overlays < 1240 px      |
| 23 | Switch light and dark themes     | Pass              | Contrast test; native smoke test                            |

Final acceptance criteria from the specification that are not yet met are
listed in `UI_PROGRESS.md` under "Open".
