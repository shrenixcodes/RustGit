> **Historical record:** This document captures an earlier project state. Statuses, branches, findings, and verification results below have not been revalidated for the current release. See the [README](../README.md) and current source for present behavior.

> **Composition superseded** by `SCREEN_MODEL.md`. Decisions D-1 (real index),
> D-6 (destructive actions), D-12 (rendering) and D-14/D-15 (ownership, state) still apply.

# RustGit UX decisions

Each decision names the Git workflow it serves. Design codename:
**Orbital Instrumentation**: the commit graph is the central instrument,
inspectors are the data columns around it, and operations are observable
events on a bottom shelf.

Priority order when decisions conflict: correctness, usability, information
clarity, performance, visual identity, decoration.

## D-1 The UI shows Git's real index

Workflow: stage part of a file, switch to the terminal, run `git status`,
come back.

RustGit stages with `git add`, `git apply --cached` and `git restore --staged`
at the moment the user acts, and reads state back from `git status`. There
is no hidden selection model. Consequences:

- A partially staged file appears in **both** the Staged and Unstaged groups
  and carries a "partially staged" marker in both, so a staged entry is never
  mistaken for the whole file.
- The diff for a selected file shows the staged and unstaged diffs as two
  labelled sections, each with its own actions.
- Committing commits the index only. The composer states the staged file
  count and line totals, and is disabled with an explanation when the index
  is empty.

## D-2 One workspace per task, not one layout for everything

| Section   | Composition                                                  |
| --------- | ------------------------------------------------------------ |
| Changes   | file list · diff · inspector (file); commit composer under the list |
| History   | graph+log · commit inspector                                 |
| Branches  | branch list · branch inspector                               |
| Overview  | status summary and health diagnostics                        |

The composer lives under the file list (GitHub Desktop's strongest pattern)
because "pick changes → describe → commit" should never require navigation.

## D-3 Navigation rail, collapsible

Workflow: switching between Changes and History dozens of times a day.

A left rail with icons and labels; collapses to icons only (with tooltips and
the same shortcuts) below 1100 px window width or on demand. Sections that are
not implemented are shown disabled with "Soon". They are never hidden (so the
roadmap is honest) and never clickable (so nothing is faked). The repository
switcher sits at the top of the rail, so switching repositories never requires
going back to a home screen.

## D-4 Contextual inspector instead of detail pages

Workflow: scan many items and look at one in detail without losing the list.

The inspector on the right reflects the current selection (file, later commit,
branch, operation). It is resizable, collapsible, remembered per user, and
auto-hidden below 1280 px of available width, with a toggle to bring it back.

## D-5 Operation shelf with real command records

Workflow: a push or hook fails and the user needs to know why.

A 28 px shelf at the bottom shows: repository, branch, ahead/behind, the
running operation (name and elapsed time only, never invented percentages),
and a toggle for the activity panel. The activity panel lists every operation
RustGit ran with its Git commands (arguments redacted by the engine), working
directory, exit code, duration and stderr. The engine already keeps a
200-entry redacted command history; exposing it is backend request R-1.
Until then the panel lists the operations the UI itself invoked (name, start
time, duration, outcome, backend error message), which is real application
state.

## D-6 Destructive actions are explicit, non-destructive ones are instant

- Stage, unstage, stage hunk, unstage hunk: immediate, no confirmation, because
  each has an exact inverse that is one click away.
- Discard (working tree changes, untracked files, hunks): a confirmation dialog
  that names the file or hunk and states that the change cannot be recovered
  from Git. The confirm button is labelled with the action ("Discard 3 lines"),
  not "OK". The default focus is Cancel.
- Amend: a checkbox in the composer; when the previous commit is already on
  the upstream, a warning that the push will need `--force-with-lease`.

## D-7 Color carries identity, text carries meaning

The Orbital palette assigns roles: cyan = active/selected/current, amber =
attention/pending/incoming, lavender = secondary branch identity, green =
success/clean, red = error/conflict/destructive. Every status that uses color
also has a letter, icon or word (file status letters M/A/D/R/U/!, "partially
staged", text in toasts). Contrast is verified by a unit test that computes
WCAG ratios from `tokens.css`.

## D-8 Typography

Inter for UI, JetBrains Mono for paths, hashes, branch names, diffs and Git
output. Section labels are small uppercase with +0.06em tracking. Base size
13 px; minimum 11 px for labels only, never for diff content (12 px).

## D-9 Density

Two densities, compact (default, 24 px rows) and comfortable (28 px rows),
on a 4 px grid. Diff line height stays 18/20 px so code remains readable.

## D-10 Motion

Transitions only for hover/selection color (≤120 ms) and panel toggles.
No animated backgrounds, no glow pulses. `prefers-reduced-motion` and the
in-app "Reduce motion" setting disable all transitions.

## D-11 Technical grid

A faint 24 px grid is used only behind the commit graph canvas and the empty
state of the diff area. Never behind text-heavy lists or diff lines.

## D-12 Rendering strategy

- Lists and diffs: windowed rendering with fixed row heights (custom hook).
- Diffs larger than 2 MB or 20 000 lines are not rendered inline; the user is
  told the size and can open the file externally.
- Binary files: detected by Git (`Binary files differ`) and shown as such.
- Commit graph: custom lane layout + SVG per visible row (see research).

## D-13 Dependencies

Added only with a concrete need: none of Radix, Virtuoso, React Flow,
react-resizable-panels or Pierre are added in the first Changes milestone.
Each will be re-evaluated when its feature lands, and the decision recorded
here.

## D-14 Session ownership and integration

The UI session owns the frontend (`apps/desktop/src`, UI docs,
`UI_PROGRESS.md`). The core session owns the Rust crates, Tauri commands,
capabilities, CI and `BUILD_PROGRESS.md`. The UI calls only commands listed
in `docs/integration/API_CONTRACT.md`; missing capabilities are filed in
`docs/integration/INTEGRATION_STATUS.md`, and the affected UI is shown as
unavailable rather than simulated.

## D-15 State ownership

- Server state (status, diffs, log, branches, command history): TanStack
  Query, keyed by repository id, invalidated after every mutation.
- Client state (section, selection, panel sizes, density, inspector
  visibility): Zustand, with layout persisted to `localStorage` (UI-only
  preferences; repository data stays in SQLite).
- Mutations take the backend's per-repository write lock, so two operations
  on one repository never interleave.
