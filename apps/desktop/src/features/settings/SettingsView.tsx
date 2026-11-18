import type { ReactNode } from "react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl, type SegmentOption } from "../../components/SegmentedControl";
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

const MOTION_OPTIONS: readonly SegmentOption<MotionPreference>[] = [
  { value: "system", label: "Follow system" },
  { value: "reduce", label: "Reduce" },
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" visible />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-2xl divide-y divide-divider px-8">
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
            description="Reduce turns off transitions even when the operating system allows them."
          >
            <SegmentedControl label="Motion" options={MOTION_OPTIONS} value={motion} onChange={setMotion} />
          </Setting>

          <Setting
            label="GitHub"
            description="Sign in to clone from your GitHub repositories and publish new ones. The token is kept in the system credential store."
          >
            <GithubAccount />
          </Setting>

          <Setting label="Git" description="RustGit runs the Git executable found on PATH.">
            {gitInfo.isPending && <p className="text-fg-muted">Detecting Git…</p>}
            {gitInfo.isError && <ErrorNotice title="Git is not available" error={gitInfo.error} />}
            {gitInfo.data !== undefined && (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                <dt className="text-fg-muted">Version</dt>
                <dd data-selectable className="font-mono">
                  {gitInfo.data.version}
                </dd>
                <dt className="text-fg-muted">Executable</dt>
                <dd data-selectable className="font-mono">
                  {gitInfo.data.executable}
                </dd>
              </dl>
            )}
          </Setting>

          <Setting
            label="Updates"
            description="RustGit checks for official releases and can automatically update itself without leaving the app."
          >
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-4">
                <span className="text-fg-muted">Current version:</span>
                <span className="font-mono">{updateCheck.data?.currentVersion ?? "0.1.0"}</span>
                <Button
                  variant="secondary"
                  disabled={updateCheck.isFetching}
                  onClick={() => void updateCheck.refetch()}
                >
                  {updateCheck.isFetching ? "Checking…" : "Check for updates"}
                </Button>
              </div>

              {updateCheck.isError && (
                <ErrorNotice title="Failed to check for updates" error={updateCheck.error} />
              )}

              {updateCheck.data?.hasUpdate ? (
                <div className="rounded border border-accent/40 bg-accent/10 p-3 space-y-2">
                  <div className="font-medium text-fg">
                    A new version is available: {updateCheck.data.latestVersion}
                  </div>
                  {updateCheck.data.releaseNotes && (
                    <p className="text-xs text-fg-muted whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {updateCheck.data.releaseNotes}
                    </p>
                  )}
                  {installUpdate.isError && (
                    <p className="text-danger text-xs">{installUpdate.error.message}</p>
                  )}
                  <Button
                    variant="primary"
                    disabled={installUpdate.isPending || !updateCheck.data.downloadUrl}
                    onClick={() => {
                      if (updateCheck.data?.downloadUrl && updateCheck.data?.assetName) {
                        installUpdate.mutate({
                          downloadUrl: updateCheck.data.downloadUrl,
                          assetName: updateCheck.data.assetName,
                        });
                      }
                    }}
                  >
                    {installUpdate.isPending ? "Downloading & Installing…" : "Install update"}
                  </Button>
                </div>
              ) : (
                updateCheck.data !== undefined && !updateCheck.isFetching && (
                  <p className="text-xs text-fg-muted">RustGit is up to date.</p>
                )
              )}
            </div>
          </Setting>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid grid-cols-[180px_1fr] gap-6 py-4">
      <div>
        <h2 className="font-medium">{label}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
