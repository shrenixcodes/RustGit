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
    <main>
      <h1>RustGit</h1>
      <p>Git, without the overhead.</p>
      {version !== null && <p>Version {version}</p>}
    </main>
  );
}
