/**
 * Every keyboard shortcut RustGit handles, for the reference sheet ("?").
 * Kept beside the handlers' own lists (AppShell, ThreadView, ReviewStream,
 * ConflictResolver); `shortcutReference.test.ts` checks the global ones
 * against AppShell so the sheet cannot drift from what works.
 */

export interface ShortcutEntry {
  keys: string;
  action: string;
}

export interface ShortcutGroup {
  title: string;
  /** Where the keys apply. */
  scope: string;
  entries: readonly ShortcutEntry[];
}

export const GLOBAL_SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: "Mod+K", action: "Commands" },
  { keys: "Mod+P", action: "Switch repository" },
  { keys: "Mod+N", action: "Create new repository" },
  { keys: "Mod+O", action: "Open repository" },
  { keys: "Mod+Shift+O", action: "Manage repositories" },
  { keys: "Mod+,", action: "Settings" },
  { keys: "Mod+J", action: "Activity panel" },
  { keys: "Mod+Shift+D", action: "Quiet / deep workspace" },
  { keys: "Mod+R", action: "Refresh" },
  { keys: "F5", action: "Refresh" },
  { keys: "Mod+Shift+F", action: "Fetch all remotes" },
  { keys: "Mod+Shift+L", action: "Pull (default mode)" },
  { keys: "Mod+Shift+P", action: "Push the current branch" },
  { keys: "Mod+-", action: "Zoom out to the map" },
  { keys: "Mod+0", action: "Back to the thread" },
  { keys: "/", action: "Search the thread" },
  { keys: "?", action: "This reference" },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { title: "Anywhere", scope: "the whole window", entries: GLOBAL_SHORTCUTS },
  {
    title: "Thread",
    scope: "when the thread has focus",
    entries: [
      { keys: "ArrowUp / ArrowDown", action: "Previous / next node" },
      { keys: "PageUp / PageDown", action: "A screen up / down" },
      { keys: "Home / End", action: "Loose end / oldest loaded commit" },
      { keys: "Enter / ArrowRight", action: "Unfold the node" },
      { keys: "Escape / ArrowLeft", action: "Fold it again" },
      { keys: "c", action: "Write the next commit's summary" },
      { keys: "Mod+Enter", action: "Commit (in the summary)" },
    ],
  },
  {
    title: "Loose end",
    scope: "in the unfolded working tree",
    entries: [
      { keys: "ArrowUp / ArrowDown", action: "Previous / next file" },
      { keys: "Enter", action: "Expand the diff, or resolve a conflicted file" },
      { keys: "Space", action: "Stage / unstage the file" },
      { keys: "n / p", action: "Next / previous hunk" },
      { keys: "s", action: "Stage the hunk" },
      { keys: "u", action: "Unstage the hunk or the file" },
      { keys: "d", action: "Discard the hunk (confirms)" },
      { keys: "Delete", action: "Discard the file's changes (confirms)" },
      { keys: "Escape", action: "Clear the line selection" },
    ],
  },
  {
    title: "Conflict resolver",
    scope: "while resolving a file",
    entries: [{ keys: "Escape", action: "Back to the loose end" }],
  },
];
