import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

export function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((error: unknown) => {
        console.error("Failed to read application version", error);
      });
  }, []);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-2 bg-bg text-fg">
      <h1 className="text-lg font-semibold">RustGit</h1>
      <p className="text-fg-secondary">Git, without the overhead.</p>
      {version !== null && <p className="font-mono text-sm text-fg-muted tabular-nums">v{version}</p>}
    </main>
  );
}
