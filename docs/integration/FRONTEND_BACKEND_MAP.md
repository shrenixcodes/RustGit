# Frontend ↔ backend map

Which UI surface uses which command. **Owner:** UI session. Status:
`live` = wired to a real command; `blocked` = waiting on a request in
`INTEGRATION_STATUS.md`; the UI shows blocked features as unavailable, never
simulated.

| UI surface                               | Commands / events                                    | Status        |
| ---------------------------------------- | ---------------------------------------------------- | ------------- |
| Repository switcher (rail)               | `list_repositories`, `open_repository`, `repository_status` | live   |
| Repositories view                        | `list_repositories`, `add_repository`, `init_repository`, `open_repository`, `set_repository_pinned`, `remove_repository` | live |
| Overview                                 | `repository_status`                                  | live          |
| Operation shelf: repo, branch, ↑↓        | `repository_status`                                  | live          |
| Activity panel: app operations           | frontend mutation log (UI-side records of commands it invoked, with real outcome and duration) | live |
| Activity panel: Git commands             | R-1 `command_history`                                | blocked       |
| Changes: file list, groups, filter       | `repository_status`                                  | live          |
| Changes: file inspector (status)         | `repository_status`                                  | live          |
| Changes: diff viewer, line totals        | R-2 `file_diff`                                      | blocked       |
| Changes: stage / unstage file, all       | R-3                                                  | blocked       |
| Changes: hunk / line staging             | R-4                                                  | blocked       |
| Changes: discard                         | R-4, R-5                                             | blocked       |
| Commit composer                          | R-6, R-7                                             | blocked       |
| History graph                            | R-8, R-9                                             | blocked (layout engine built and unit-tested, no screen) |
| Commit inspector                         | R-10                                                 | blocked       |
| Branches workspace                       | R-9, R-11                                            | blocked       |
| Live refresh                             | E-1 `repository-changed`                             | blocked (focus + explicit refresh used) |
| Fetch / pull / push, progress            | R-13, E-2, E-3                                       | blocked       |
| Conflict workspace                       | R-14                                                 | blocked       |
| Settings: theme                          | `get_settings`, `set_theme`                          | live          |
| Settings: Git info                       | `git_info`                                           | live          |
| Settings: density, reduce motion, layout | none (UI preferences, `localStorage`)                | live          |
| Command palette                          | the live commands above                              | live          |
