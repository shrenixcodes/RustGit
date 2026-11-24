import { useState } from "react";
import { Button } from "./Button";
import { ipc } from "../services/ipc";
import { useInstallUpdate, useUpdateCheck } from "../services/queries";

export function UpdateBanner() {
  const updateCheck = useUpdateCheck();
  const installUpdate = useInstallUpdate();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const data = updateCheck.data;
  if (!data || !data.hasUpdate || dismissedVersion === data.latestVersion) {
    return null;
  }

  const handleInstall = () => {
    if (data.downloadUrl && data.assetName) {
      installUpdate.mutate({
        downloadUrl: data.downloadUrl,
        assetName: data.assetName,
        assetDigest: data.assetDigest,
      });
    }
  };

  return (
    <div
      role="region"
      aria-label="Software update notification"
      className="flex items-center justify-between gap-4 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        <span>
          <strong className="font-semibold text-fg">RustGit {data.latestVersion}</strong> is available (current: {data.currentVersion}).
        </span>
        {installUpdate.isError && (
          <span className="text-danger ml-2">Failed to install: {installUpdate.error.message}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {data.downloadUrl !== null ? (
          <Button variant="primary" onClick={handleInstall} disabled={installUpdate.isPending}>
            {installUpdate.isPending ? "Downloading & Installing…" : "Install update"}
          </Button>
        ) : (
          // The release has no installer for this platform: offer its page instead.
          data.releaseUrl !== null && (
            <Button variant="primary" onClick={() => void ipc.openGithubPage(data.releaseUrl as string)}>
              View release
            </Button>
          )
        )}
        <button
          type="button"
          onClick={() => setDismissedVersion(data.latestVersion)}
          className="text-fg-muted hover:text-fg px-2 py-1 text-xs"
          title="Dismiss notification"
          aria-label="Dismiss update notification"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
