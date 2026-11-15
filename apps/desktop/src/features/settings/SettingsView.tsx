import type { ReactNode } from "react";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl, type SegmentOption } from "../../components/SegmentedControl";
import { useGitInfo, useSetTheme, useSettings } from "../../services/queries";
import type { ThemePreference } from "../../services/types";
import { usePreferences, type Density, type MotionPreference } from "../../stores/preferences";

const THEME_OPTIONS: readonly SegmentOption<ThemePreference>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITY_OPTIONS: readonly SegmentOption<Density>[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

const MOTION_OPTIONS: readonly SegmentOption<MotionPreference>[] = [
  { value: "system", label: "Follow system" },
  { value: "reduce", label: "Reduce" },
];

export function SettingsView() {
  const settings = useSettings();
  const setTheme = useSetTheme();
  const gitInfo = useGitInfo();
  const density: Density = usePreferences((state) => state.density);
  const setDensity = usePreferences((state) => state.setDensity);
  const motion: MotionPreference = usePreferences((state) => state.motion);
  const setMotion = usePreferences((state) => state.setMotion);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-2xl divide-y divide-divider px-4">
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

          <Setting label="Density" description="Row height in lists. Diff text size does not change.">
            <SegmentedControl label="Density" options={DENSITY_OPTIONS} value={density} onChange={setDensity} />
          </Setting>

          <Setting
            label="Motion"
            description="Reduce turns off transitions even when the operating system allows them."
          >
            <SegmentedControl label="Motion" options={MOTION_OPTIONS} value={motion} onChange={setMotion} />
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
