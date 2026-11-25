> **Historical record:** This document captures an earlier project state. Statuses, branches, findings, and verification results below have not been revalidated for the current release. See the [README](../README.md) and current source for present behavior.

# RustGit UI test plan

Three layers. A feature counts as done only when all layers that apply to
it pass. A page that renders is not proof that it works.

## 1. Component and logic tests (Vitest + Testing Library, jsdom)

Run: `pnpm test` (from the repository root).

- IPC is mocked at `@tauri-apps/api/core` `invoke` only. Fixture data lives
  in test files and is never imported by production code.
- Required for every interactive component: keyboard path, accessible name,
  loading, empty and error states, and that no action is offered for a
  capability the backend lacks.
- Pure logic (lane layout, grouping, filtering, windowing, shortcuts,
  contrast) has direct unit tests, including scale tests: 5 000-file lists
  must mount fewer than 80 rows; 10 000-commit layouts must finish under
  500 ms in jsdom.
- Token contrast: `styles/tokens.test.ts` parses `tokens.css` for both
  themes.

## 2. Native integration (real app, real Git, Windows)

`apps/desktop/tests/native/windows-smoke.mjs` (owned by the core session)
launches the built executable with an isolated `RUSTGIT_DATA_DIR`, drives
the WebView2 over the DevTools protocol, and checks the UI against a
disposable repository created with the Git CLI. The UI session keeps its
selectors working when the UI changes and reports changes in
`docs/integration/INTEGRATION_STATUS.md`.

Build: `pnpm --filter @rustgit/desktop tauri build --debug --no-bundle`.
Run: `pnpm --filter @rustgit/desktop test:native`.

## 3. Visual QA (real app screenshots)

For each screen, in dark and light themes, at 1280×720 and 1920×1080, and at
the minimum window size (900×560):

| Check                      | How                                                     |
| -------------------------- | ------------------------------------------------------- |
| Alignment, 4 px grid       | Screenshot review                                       |
| Typography                 | Inter for UI, JetBrains Mono for paths/hashes/branches  |
| Contrast                   | Automated (tokens) + review of overlays and selection   |
| Clipping and overflow      | Long paths, long branch names, many files, narrow width |
| Loading / empty / error    | Fresh data dir, clean repo, moved repo                  |
| Focus visibility           | Tab through every control                               |
| Collapsed rail, overlay inspector | Window below 1100 px / 1240 px                   |

Screenshots of real runs are stored outside the repository; findings and
fixes are recorded in `UI_PROGRESS.md`.

## Workflow tests

The 23 workflows from the specification are tracked in `UX_ACCEPTANCE.md`
with their current status. Workflows that depend on missing backend
capabilities are marked blocked with the request id.

## Usability comparison with GitHub Desktop

Not started. Comparisons need the staging, commit and history workflows
(blocked on R-2 … R-9). Method once unblocked: same fixture repository,
same task script, measure time, interaction count (clicks + keystrokes),
navigation steps, errors and recovery time, for both clients. No usability
claim is made before that data exists.
