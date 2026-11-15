// Native smoke test for the RustGit desktop app on Windows.
//
// Launches the real built executable against a disposable Git repository,
// connects to its WebView2 through the Chrome DevTools Protocol and drives the
// actual UI. Nothing here mocks the backend.
//
// Usage: node tests/native/windows-smoke.mjs <path-to-rustgit.exe> [screenshot-dir]

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
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

  await page.getByText("main", { exact: true }).first().waitFor();
  const overview = await page.locator("main").innerText();
  expectText(overview, "Staged\n1", "staged count");
  expectText(overview, "Unstaged\n2", "unstaged count");
  expectText(overview, "Untracked\n1", "untracked count");
  expectText(overview, git("rev-parse", "HEAD").slice(0, 12), "commit id");
  step("overview shows branch, commit and change counts from Git");
  await shoot(page, "02-overview");

  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const changes = page.locator("main");
  await changes.getByText("staged.txt").waitFor();
  for (const name of ["tracked.txt", "remove-me.txt", "untracked.md"]) {
    await changes.getByText(name).waitFor();
  }
  step("changes view lists every changed file");
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
