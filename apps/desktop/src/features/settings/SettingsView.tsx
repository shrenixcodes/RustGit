import type { ReactNode } from "react";
import { ArrowUpCircle, Check, Copy, KeyRound, Palette, RefreshCw, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl, type SegmentOption } from "../../components/SegmentedControl";
import { ipc } from "../../services/ipc";
import { useGitInfo, useInstallUpdate, useSetTheme, useSettings, useUpdateCheck } from "../../services/queries";
import type { ThemePreference } from "../../services/types";
import { usePreferences, type MotionPreference, type Personality } from "../../stores/preferences";
import { GithubAccount } from "./GithubAccount";

const THEME_OPTIONS: readonly SegmentOption<ThemePreference>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const PERSONALITY_OPTIONS: readonly SegmentOption<Personality>[] = [
  { value: "quiet", label: "Quiet" },
  { value: "deep", label: "Deep" },
];

const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);
const systemMotionLabel = isWindows ? "Follow Windows" : "Follow system";

const MOTION_OPTIONS: readonly SegmentOption<MotionPreference>[] = [
  { value: "full", label: "Full" },
  { value: "system", label: systemMotionLabel },
  { value: "reduce", label: "Reduced" },
];

export function SettingsView() {
  const settings = useSettings();
  const setTheme = useSetTheme();
  const gitInfo = useGitInfo();
  const updateCheck = useUpdateCheck();
  const installUpdate = useInstallUpdate();
  const personality: Personality = usePreferences((state) => state.personality);
  const setPersonality = usePreferences((state) => state.setPersonality);
  const motion: MotionPreference = usePreferences((state) => state.motion);
  const setMotion = usePreferences((state) => state.setMotion);
  const autoFetch: boolean = usePreferences((state) => state.autoFetch);
  const setAutoFetch = usePreferences((state) => state.setAutoFetch);
  const [copiedExec, setCopiedExec] = useState(false);

  const copyExecPath = (path: string) => {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopiedExec(true);
      setTimeout(() => setCopiedExec(false), 2000);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" visible />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-8 pb-8">
        <div className="w-full max-w-[960px] space-y-4">
          {/* Appearance Section */}
          <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs space-y-5">
            <h3 className="font-semibold text-xs text-fg flex items-center gap-2">
              <Palette className="size-4 text-accent" />
              <span>Appearance & Workspace</span>
            </h3>

            <div className="divide-y divide-divider/70">
              <Setting label="Theme" description="System follows the operating system and updates when it changes.">
                {settings.isError && <ErrorNotice title="Could not load settings" error={settings.error} />}
                {setTheme.isError && <ErrorNotice title="Could not save theme" error={setTheme.error} />}
                <SegmentedControl
                  label="Theme"
                  options={THEME_OPTIONS}
                  value={settings.data?.theme}
                  onChange={(theme: ThemePreference) => setTheme.mutate(theme)}
                  disabled={settings.data === undefined || setTheme.isPending}
                />
              </Setting>

              <Setting
                label="Workspace"
                description="Quiet is spacious, for daily work. Deep is darker and denser, for history and investigation. Ctrl+Shift+D switches."
              >
                <SegmentedControl label="Workspace" options={PERSONALITY_OPTIONS} value={personality} onChange={setPersonality} />
              </Setting>

              <Setting
                label="Motion"
                description={`Full enables all transitions and animations. ${systemMotionLabel} matches operating system settings. Reduced turns off motion.`}
              >
                <SegmentedControl label="Motion" options={MOTION_OPTIONS} value={motion} onChange={setMotion} />
              </Setting>
            </div>
          </div>

          {/* Accounts Section */}
          <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs space-y-4">
            <h3 className="font-semibold text-xs text-fg flex items-center gap-2">
              <KeyRound className="size-4 text-accent" />
              <span>Accounts & Integration</span>
            </h3>

            <Setting
              label="GitHub"
              description="Sign in to clone from your GitHub repositories and publish new ones. The token is kept in the system credential store."
            >
              <GithubAccount />
            </Setting>
          </div>

          {/* Git Environment Section */}
          <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs space-y-4">
            <h3 className="font-semibold text-xs text-fg flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Terminal className="size-4 text-accent" />
                <span>Git Environment</span>
              </span>
              {gitInfo.data !== undefined && (
                <span className="flex items-center gap-1.5 font-mono text-2xs text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  <span>operational</span>
                </span>
              )}
            </h3>

            <Setting
              label="Background fetch"
              description="Fetch the open repository's remotes every 5 minutes while RustGit is visible. It never asks for credentials; a failed fetch is only noted in Activity."
            >
              <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoFetch}
                  onChange={(event) => setAutoFetch(event.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Fetch automatically</span>
              </label>
            </Setting>

            <Setting label="Git" description="RustGit runs the Git executable found on PATH.">
              {gitInfo.isPending && <p className="text-xs text-fg-muted font-mono">Detecting Git…</p>}
              {gitInfo.isError && <ErrorNotice title="Git is not available" error={gitInfo.error} />}
              {gitInfo.data !== undefined && (
                <div className="space-y-2 rounded-xl border border-border/70 bg-canvas/60 p-3.5 text-xs shadow-2xs">
                  <dl className="grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-2">
                    <dt className="text-fg-muted text-2xs uppercase tracking-wider font-semibold">Version</dt>
                    <dd data-selectable className="font-mono text-fg font-semibold">
                      <span className="rounded bg-elevated border border-border px-2 py-0.5">
                        {gitInfo.data.version}
                      </span>
                    </dd>
                    <dt className="text-fg-muted text-2xs uppercase tracking-wider font-semibold">Executable</dt>
                    <dd className="flex items-center gap-2 min-w-0">
                      <span data-selectable className="font-mono text-xs text-fg-secondary truncate">
                        {gitInfo.data.executable}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyExecPath(gitInfo.data!.executable)}
                        title={copiedExec ? "Copied executable path" : "Copy path"}
                        className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg shrink-0 transition-colors"
                      >
                        {copiedExec ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                      </button>
                    </dd>
                  </dl>
                </div>
              )}
            </Setting>
          </div>

          {/* Software Updates Section */}
          <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs space-y-4">
            <h3 className="font-semibold text-xs text-fg flex items-center gap-2">
              <ArrowUpCircle className="size-4 text-accent" />
              <span>Application Updates</span>
            </h3>

            <Setting
              label="Updates"
              description="RustGit checks for official releases and can automatically update itself without leaving the app."
            >
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-canvas/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-fg-muted">Installed version:</span>
                    <span className="font-mono font-semibold text-fg">{updateCheck.data?.currentVersion ?? "0.3.2"}</span>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={updateCheck.isFetching}
                    onClick={() => void updateCheck.refetch()}
                    className="h-7 text-xs"
                  >
                    <RefreshCw className={`size-3 mr-1 ${updateCheck.isFetching ? "motion-safe:animate-spin" : ""}`} />
                    {updateCheck.isFetching ? "Checking…" : "Check for updates"}
                  </Button>
                </div>

                {updateCheck.isError && (
                  <ErrorNotice title="Failed to check for updates" error={updateCheck.error} />
                )}

                {updateCheck.data?.hasUpdate ? (
                  <div className="rounded-lg border border-accent/40 bg-accent/10 p-3.5 space-y-2.5">
                    <div className="font-semibold text-xs text-fg">
                      A new version is available: {updateCheck.data.latestVersion}
                    </div>
                    {updateCheck.data.releaseNotes && (
                      <div className="rounded border border-border/60 bg-canvas/80 p-2.5">
                        <p className="text-2xs text-fg-muted whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
                          {updateCheck.data.releaseNotes}
                        </p>
                      </div>
                    )}
                    {installUpdate.isError && (
                      <p className="text-danger text-xs">{installUpdate.error.message}</p>
                    )}
                    {updateCheck.data.downloadUrl !== null ? (
                      <Button
                        variant="primary"
                        disabled={installUpdate.isPending}
                        onClick={() => {
                          if (updateCheck.data?.downloadUrl && updateCheck.data?.assetName) {
                            installUpdate.mutate({
                              downloadUrl: updateCheck.data.downloadUrl,
                              assetName: updateCheck.data.assetName,
                              assetDigest: updateCheck.data.assetDigest,
                            });
                          }
                        }}
                      >
                        {installUpdate.isPending ? "Downloading & Installing…" : "Install update"}
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-2xs text-fg-muted">This release has no installer for your operating system yet.</p>
                        {updateCheck.data.releaseUrl !== null && (
                          <Button variant="secondary" onClick={() => void ipc.openGithubPage(updateCheck.data?.releaseUrl as string)}>
                            View release on GitHub
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  updateCheck.data !== undefined && !updateCheck.isFetching && (
                    <p className="text-2xs text-fg-muted flex items-center gap-1.5 pt-1">
                      <span className="size-1.5 rounded-full bg-success" />
                      <span>RustGit is up to date.</span>
                    </p>
                  )
                )}
              </div>
            </Setting>
          </div>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 py-3.5">
      <div>
        <h4 className="font-medium text-xs text-fg">{label}</h4>
        <p className="mt-1 text-2xs text-fg-muted leading-relaxed">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
