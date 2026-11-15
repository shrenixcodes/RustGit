import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { useGitInfo, useSetTheme, useSettings } from "../../services/queries";
import type { ThemePreference } from "../../services/types";

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsView() {
  const settings = useSettings();
  const setTheme = useSetTheme();
  const gitInfo = useGitInfo();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <div className="max-w-xl space-y-6 overflow-y-auto p-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">Theme</legend>
          {settings.isError && <ErrorNotice title="Could not load settings" error={settings.error} />}
          {setTheme.isError && <ErrorNotice title="Could not save theme" error={setTheme.error} />}
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-sm border border-border-control p-0.5">
            {THEME_OPTIONS.map((option) => {
              const checked: boolean = settings.data?.theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={settings.data === undefined || setTheme.isPending}
                  onClick={() => setTheme.mutate(option.value)}
                  className={`h-6 rounded-[3px] px-3 text-sm ${
                    checked ? "bg-selection font-medium text-fg" : "text-fg-secondary hover:text-fg"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <section className="space-y-2">
          <h2 className="font-medium">Git</h2>
          {gitInfo.isPending && <p className="text-fg-muted">Detecting Git…</p>}
          {gitInfo.isError && <ErrorNotice title="Git is not available" error={gitInfo.error} />}
          {gitInfo.data !== undefined && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-fg-muted">Version</dt>
              <dd className="font-mono">{gitInfo.data.version}</dd>
              <dt className="text-fg-muted">Executable</dt>
              <dd className="font-mono">{gitInfo.data.executable}</dd>
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
