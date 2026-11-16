// Native smoke test for the RustGit desktop app on Windows.
//
// Launches the real built executable against a disposable Git repository,
// connects to its WebView2 through the Chrome DevTools Protocol and drives the
// actual UI. Nothing here mocks the backend.
//
// Usage: node tests/native/windows-smoke.mjs <path-to-rustgit.exe> [screenshot-dir]

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const CDP_PORT = 9333;
const COMMIT_MESSAGE = "Smoke commit\n\nBody";
const executable = process.argv[2];
const screenshotDir = process.argv[3] ? resolve(process.argv[3]) : null;
if (!executable) {
  console.error("usage: windows-smoke.mjs <rustgit.exe> [screenshot-dir]");
  process.exit(2);
}

const workDir = mkdtempSync(join(tmpdir(), "rustgit-smoke-"));
const repoDir = join(workDir, "smoke-repo");
const dataDir = join(workDir, "data");

function git(...args) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
}

function step(message) {
  console.log(`- ${message}`);
}

function createFixture() {
  mkdirSync(repoDir);
  git("init", "--initial-branch=main");
  git("config", "user.name", "RustGit Smoke");
  git("config", "user.email", "smoke@rustgit.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repoDir, "tracked.txt"), "one\n");
  writeFileSync(join(repoDir, "remove-me.txt"), "bye\n");
  git("add", ".");
  git("commit", "-m", "initial");
  writeFileSync(join(repoDir, "tracked.txt"), "two\n"); // unstaged modification
  unlinkSync(join(repoDir, "remove-me.txt")); // unstaged deletion
  writeFileSync(join(repoDir, "staged.txt"), "new\n");
  git("add", "staged.txt"); // staged addition
  writeFileSync(join(repoDir, "untracked.md"), "x\n"); // untracked
}

async function connect() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) {
      throw new Error(`application exited early with code ${app.exitCode}`);
    }
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  throw new Error(`could not connect to the WebView: ${lastError}`);
}

function expectText(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label}: expected to contain "${expected}", got "${actual}"`);
  }
}

async function shoot(page, name) {
  if (screenshotDir) {
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
  }
}

let app;
let exited;
const logs = [];
let exitCode = 1;
try {
  createFixture();
  step(`fixture repository at ${repoDir}`);

  app = spawn(resolve(executable), [], {
    env: {
      ...process.env,
      RUSTGIT_DATA_DIR: dataDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  app.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  exited = new Promise((done) => app.on("exit", (code) => done(code)));

  const browser = await connect();
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) {
    throw new Error("no page found in the WebView");
  }
  step("connected to the application WebView");

  await page.getByText("No repositories yet").waitFor({ timeout: 20_000 });
  step("empty repository list rendered");
  await shoot(page, "01-empty");

  // The folder picker is a native OS dialog; register the repository through
  // the same backend command the picker result is passed to.
  const added = await page.evaluate(
    (path) => window.__TAURI_INTERNALS__.invoke("add_repository", { path }),
    repoDir,
  );
  if (added.name !== "smoke-repo") {
    throw new Error(`unexpected repository entry ${JSON.stringify(added)}`);
  }
  await page.reload();
  await page.getByRole("button", { name: "Open smoke-repo" }).click();
  step("repository added and opened through the UI");

  // The thread (UI branch worktree-ui-orbital): the seal names the branch, the
  // loose end summarises the working tree, commits follow.
  await page.getByText("main", { exact: true }).first().waitFor();
  const looseEnd = page.getByRole("treeitem", { name: /^Uncommitted changes:/ });
  await looseEnd.waitFor();
  const summary = await looseEnd.getAttribute("aria-label");
  expectText(summary, "1 staged", "staged count");
  expectText(summary, "2 unstaged", "unstaged count");
  expectText(summary, "1 untracked", "untracked count");
  const head = git("rev-parse", "HEAD").slice(0, 7);
  await page.locator("main").getByText(head, { exact: true }).waitFor();
  step("thread shows branch, HEAD commit and change counts from Git");
  await shoot(page, "02-thread");

  // Unfold the loose end with the keyboard: every changed file is listed.
  await page.getByRole("tree", { name: "Thread" }).focus();
  await page.keyboard.press("Enter");
  const changes = page.getByRole("group", { name: "Uncommitted changes" });
  await changes.getByText("staged.txt").waitFor();
  for (const name of ["tracked.txt", "remove-me.txt", "untracked.md"]) {
    await changes.getByText(name).waitFor();
  }
  step("unfolded loose end lists every changed file");
  await shoot(page, "03-changes");

  // External change, then explicit refresh.
  writeFileSync(join(repoDir, "later.txt"), "later\n");
  await page.getByRole("button", { name: "Refresh" }).click();
  await changes.getByText("later.txt").waitFor();
  step("refresh picks up a file created outside RustGit");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.getByText(/^\d+\.\d+/).first().waitFor();
  await shoot(page, "04-settings-light");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  step("theme preference persists across reload");

  // --- IPC contract C-1 through the real backend -------------------------
  const invoke = (command, args) =>
    page.evaluate(
      ([name, payload]) =>
        window.__TAURI_INTERNALS__.invoke(name, payload).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error }),
        ),
      [command, args ?? {}],
    );
  const ok = async (command, args) => {
    const result = await invoke(command, args);
    if (!result.ok) {
      throw new Error(`${command} failed: ${JSON.stringify(result.error)}`);
    }
    return result.value;
  };
  const failsWith = async (kind, command, args) => {
    const result = await invoke(command, args);
    if (result.ok || result.error.kind !== kind) {
      throw new Error(`${command}: expected ${kind}, got ${JSON.stringify(result)}`);
    }
  };
  const id = added.id;

  const diff = await ok("file_diff", {
    id, path: "tracked.txt", originalPath: null, side: "unstaged", ignoreWhitespace: false,
  });
  if (diff.hunks.length !== 1 || diff.added !== 1 || diff.deleted !== 1) {
    throw new Error(`unexpected diff ${JSON.stringify(diff)}`);
  }
  let status = await ok("apply_hunk", {
    id, path: "tracked.txt", side: "unstaged", action: "stage",
    hunkHeader: diff.hunks[0].header, lineIndices: null,
  });
  const tracked = status.files.find((file) => file.path === "tracked.txt");
  if (tracked?.staged !== "modified" || tracked.unstaged !== null) {
    throw new Error(`hunk not staged: ${JSON.stringify(tracked)}`);
  }
  step("file_diff and apply_hunk stage a hunk");

  await failsWith("stale_diff", "apply_hunk", {
    id, path: "tracked.txt", side: "unstaged", action: "stage",
    hunkHeader: diff.hunks[0].header, lineIndices: null,
  });
  await failsWith("invalid_request", "stage_paths", { id, paths: ["../escape.txt"] });
  step("stale_diff and invalid_request reach the UI as typed errors");

  const totals = await ok("change_totals", { id, side: "staged" });
  if (totals.added !== 2 || totals.deleted !== 1) {
    throw new Error(`unexpected totals ${JSON.stringify(totals)}`);
  }
  const context = await ok("commit_context", { id });
  if (context.authorName !== "RustGit Smoke" || context.head === null || context.inProgress !== "none") {
    throw new Error(`unexpected commit context ${JSON.stringify(context)}`);
  }
  step("change_totals and commit_context");

  status = await ok("discard_paths", { id, paths: ["untracked.md", "later.txt"] });
  if (status.files.some((file) => file.path === "untracked.md" || file.path === "later.txt")) {
    throw new Error("untracked files were not discarded");
  }
  status = await ok("stage_paths", { id, paths: ["remove-me.txt"] });
  const commit = await ok("create_commit", { id, message: COMMIT_MESSAGE, amend: false });
  if (commit.oid !== git("rev-parse", "HEAD") || commit.summary !== "Smoke commit") {
    throw new Error(`unexpected commit ${JSON.stringify(commit)}`);
  }
  if (commit.status.files.length !== 0) {
    throw new Error(`tree not clean after commit: ${JSON.stringify(commit.status.files)}`);
  }
  const after = await ok("commit_context", { id });
  if (after.head?.message !== COMMIT_MESSAGE) {
    throw new Error(`unexpected HEAD message ${JSON.stringify(after.head)}`);
  }
  await failsWith("nothing_to_commit", "create_commit", { id, message: "empty", amend: false });
  const history = await ok("command_history", { repositoryId: id, sinceSequence: null });
  if (!history.some((record) => record.args.includes("commit") && record.repositoryId === id)) {
    throw new Error("command history does not attribute the commit to the repository");
  }
  const newer = await ok("command_history", {
    repositoryId: null,
    sinceSequence: history[history.length - 1].sequence,
  });
  if (newer.some((record) => record.sequence <= history[history.length - 1].sequence)) {
    throw new Error("sinceSequence filter returned older records");
  }
  step("discard, stage, commit, nothing_to_commit and filtered command_history");

  // --- Contract C-2 through the real backend ------------------------------
  // Subscribe to backend events the same way @tauri-apps/api does.
  await page.evaluate(() => {
    window.__smokeEvents = [];
    for (const name of ["operation-progress", "operation-finished", "repository-changed"]) {
      const handler = window.__TAURI_INTERNALS__.transformCallback((event) =>
        window.__smokeEvents.push({ name, payload: event.payload }),
      );
      window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
        event: name,
        target: { kind: "Any" },
        handler,
      });
    }
  });
  const waitForEvent = async (predicate, label) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const events = await page.evaluate(() => window.__smokeEvents);
      const match = events.find(predicate);
      if (match) {
        return match.payload;
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const finished = (operationId) =>
    waitForEvent(
      (event) => event.name === "operation-finished" && event.payload.operationId === operationId,
      `finish of ${operationId}`,
    );
  const LF = String.fromCharCode(10);

  const page1 = await ok("log_page", {
    id, revisions: null, skip: 0, limit: 1, search: null, since: null, until: null,
  });
  if (page1.commits[0].oid !== git("rev-parse", "HEAD") || !page1.hasMore) {
    throw new Error(`unexpected log page ${JSON.stringify(page1)}`);
  }
  const details = await ok("commit_details", { id, oid: page1.commits[0].oid });
  if (!details.files.some((file) => file.path === "remove-me.txt" && file.kind === "deleted")) {
    throw new Error(`unexpected commit details ${JSON.stringify(details.files)}`);
  }
  const commitDiff = await ok("commit_file_diff", {
    id, oid: details.oid, path: "tracked.txt", originalPath: null, contextLines: null,
  });
  if (commitDiff.side !== "commit" || commitDiff.added !== 1) {
    throw new Error(`unexpected commit diff ${JSON.stringify(commitDiff)}`);
  }
  step("log_page, commit_details and commit_file_diff");

  let refs = await ok("create_branch", { id, name: "smoke-topic", startPoint: null, checkout: true });
  if (refs.head.name !== "smoke-topic") {
    throw new Error(`branch not checked out: ${JSON.stringify(refs.head)}`);
  }
  await failsWith("invalid_ref_name", "create_branch", {
    id, name: "bad..name", startPoint: null, checkout: false,
  });
  writeFileSync(join(repoDir, "tracked.txt"), `topic side${LF}`);
  await ok("stage_paths", { id, paths: ["tracked.txt"] });
  await ok("create_commit", { id, message: "topic change", amend: false });
  await ok("checkout_branch", { id, name: "main", mode: "keep_changes" });
  writeFileSync(join(repoDir, "tracked.txt"), `main side${LF}`);
  await ok("stage_paths", { id, paths: ["tracked.txt"] });
  await ok("create_commit", { id, message: "main change", amend: false });
  const comparison = await ok("compare_revisions", { id, base: "main", head: "smoke-topic", mergeBase: true });
  if (comparison.ahead !== 1 || comparison.behind !== 1 || comparison.mergeBase === null
    || comparison.files.length !== 1 || comparison.files[0].path !== "tracked.txt") {
    throw new Error(`unexpected comparison ${JSON.stringify(comparison)}`);
  }
  const compareDiff = await ok("compare_file_diff", {
    id, base: "main", head: "smoke-topic", mergeBase: true, path: "tracked.txt", originalPath: null, contextLines: null,
  });
  if (compareDiff.side !== "commit" || compareDiff.added !== 1) {
    throw new Error(`unexpected compare diff ${JSON.stringify(compareDiff)}`);
  }
  await failsWith("invalid_request", "compare_revisions", { id, base: "main", head: "no-such-branch", mergeBase: true });
  step("compare_revisions and compare_file_diff");
  const merge = await ok("merge_branch", { id, source: "smoke-topic", strategy: "default" });
  if (merge.outcome !== "conflicts" || merge.status.inProgress !== "merging") {
    throw new Error(`expected conflicts: ${JSON.stringify(merge)}`);
  }
  const versions = await ok("conflict_versions", { id, path: "tracked.txt" });
  if (!versions.working.includes("<<<<<<<") || versions.theirs !== `topic side${LF}`) {
    throw new Error(`unexpected conflict versions ${JSON.stringify(versions)}`);
  }
  await ok("resolve_conflict", { id, path: "tracked.txt", content: `resolved${LF}`, take: null });
  const continued = await ok("continue_operation", { id });
  if (continued.outcome !== "completed" || continued.status.inProgress !== "none") {
    throw new Error(`merge did not complete: ${JSON.stringify(continued)}`);
  }
  refs = await ok("delete_branch", { id, name: "smoke-topic", force: false });
  if (refs.refs.some((ref) => ref.shortName === "smoke-topic")) {
    throw new Error("branch not deleted");
  }
  step("branches, merge conflict, conflict_versions, resolve and continue");

  writeFileSync(join(repoDir, "tracked.txt"), `stashed${LF}`);
  await ok("create_stash", { id, message: "smoke stash", includeUntracked: false });
  const stashes = await ok("list_stashes", { id });
  const applied = await ok("apply_stash", { id, oid: stashes[0].oid, pop: true });
  if (applied.outcome !== "completed" || readFileSync(join(repoDir, "tracked.txt"), "utf8") !== `stashed${LF}`) {
    throw new Error(`stash pop failed: ${JSON.stringify(applied)}`);
  }
  await ok("discard_paths", { id, paths: ["tracked.txt"] });
  const worktreePath = join(workDir, "smoke-worktree");
  let worktrees = await ok("add_worktree", {
    id, path: worktreePath, branch: null, newBranch: "wt-branch", commit: null,
  });
  if (worktrees.length !== 2) {
    throw new Error(`unexpected worktrees ${JSON.stringify(worktrees)}`);
  }
  worktrees = await ok("remove_worktree", { id, path: worktreePath, force: false });
  if (worktrees.length !== 1) {
    throw new Error("worktree not removed");
  }
  step("stash create/list/pop and worktree add/remove");

  const bare = join(workDir, "server.git");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", bare]);
  const bareUrl = `file:///${bare.split(String.fromCharCode(92)).join("/")}`;
  const remotes = await ok("add_remote", { id, name: "origin", url: bareUrl });
  if (remotes[0]?.name !== "origin") {
    throw new Error(`remote not added: ${JSON.stringify(remotes)}`);
  }
  const push = await ok("start_push", {
    id, remote: "origin", branch: "main", setUpstream: true, forceWithLease: false,
  });
  const pushed = await finished(push.operationId);
  if (pushed.outcome !== "succeeded") {
    throw new Error(`push failed: ${JSON.stringify(pushed)}`);
  }
  if (await ok("cancel_operation", { operationId: push.operationId })) {
    throw new Error("a finished operation reported a successful cancel");
  }
  const fetch = await ok("start_fetch", { id, remote: null, prune: true });
  if ((await finished(fetch.operationId)).outcome !== "succeeded") {
    throw new Error("fetch failed");
  }
  const cloneParent = join(workDir, "clones");
  mkdirSync(cloneParent);
  const clone = await ok("start_clone", {
    url: bareUrl, parentDirectory: cloneParent, directoryName: "cloned",
  });
  const cloned = await finished(clone.operationId);
  if (cloned.outcome !== "succeeded" || typeof cloned.repositoryId !== "number") {
    throw new Error(`clone failed: ${JSON.stringify(cloned)}`);
  }
  step("remotes, push/fetch/clone with operation-finished events");

  await ok("watch_repository", { id });
  await new Promise((done) => setTimeout(done, 500));
  writeFileSync(join(repoDir, "watched.txt"), `change${LF}`);
  const changed = await waitForEvent(
    (event) =>
      event.name === "repository-changed" &&
      event.payload.repositoryId === id &&
      event.payload.scopes.includes("worktree"),
    "repository-changed",
  );
  await ok("unwatch_repository", { id });
  step(`repository-changed event received (${changed.scopes.join(", ")})`);

  await browser.close();
  // taskkill without /F posts WM_CLOSE, i.e. a normal window close.
  execFileSync("taskkill", ["/PID", String(app.pid)]);
  const code = await Promise.race([
    exited,
    new Promise((done) => setTimeout(() => done("timeout"), 15_000)),
  ]);
  if (code !== 0) {
    throw new Error(`application exit code ${code}\n${logs.join("")}`);
  }
  step("application closed cleanly (exit code 0)");

  const fatal = logs.join("").split("\n").filter((line) => /ERROR|panicked/.test(line));
  if (fatal.length > 0) {
    throw new Error(`errors in application log:\n${fatal.join("\n")}`);
  }
  step("no errors in application log");
  exitCode = 0;
  console.log("SMOKE TEST PASSED");
} catch (error) {
  console.error(`SMOKE TEST FAILED: ${error instanceof Error ? error.stack : error}`);
  console.error(`--- application output ---
${logs.join("")}--- end ---`);
  if (process.env.RUSTGIT_SMOKE_KEEP_APP_ON_FAILURE === "1") {
    console.error("leaving the application running for diagnostics");
  } else if (app && app.exitCode === null) {
    app.kill();
    await exited;
  }
} finally {
  if (exitCode !== 0 && process.env.RUSTGIT_SMOKE_KEEP_APP_ON_FAILURE === "1") {
    process.exit(exitCode);
  }
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  process.exit(exitCode);
}
