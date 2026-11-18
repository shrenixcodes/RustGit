import { useCallback, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { ipc, toIpcError, type IpcError } from "../../services/ipc";
import { githubStatusKey, useGithubSignInEvents, useGithubStatus } from "../../services/github";
import type { GithubDeviceCode, GithubSignInFinished } from "../../services/types";

/**
 * GitHub sign-in with the device flow: RustGit shows a code, the person
 * enters it on github.com, and the token goes to the operating system's
 * credential store. RustGit never sees the GitHub password.
 */
export function GithubAccount() {
  const client: QueryClient = useQueryClient();
  const status = useGithubStatus();
  const [code, setCode] = useState<GithubDeviceCode | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  const [pat, setPat] = useState("");
  const [patBusy, setPatBusy] = useState(false);
  const [showPatInput, setShowPatInput] = useState(false);

  const finished = useCallback((result: GithubSignInFinished): void => {
    setCode(null);
    setFailure(result.error);
  }, []);
  useGithubSignInEvents(finished);

  const start = async (): Promise<void> => {
    setError(null);
    setFailure(null);
    try {
      setCode(await ipc.githubStartSignIn());
    } catch (cause: unknown) {
      setError(toIpcError(cause));
    }
  };

  const cancel = async (): Promise<void> => {
    setCode(null);
    await ipc.githubCancelSignIn().catch(() => {});
  };

  const signOut = async (): Promise<void> => {
    setError(null);
    try {
      await ipc.githubSignOut();
      await client.invalidateQueries({ queryKey: githubStatusKey });
    } catch (cause: unknown) {
      setError(toIpcError(cause));
    }
  };

  const savePat = async (): Promise<void> => {
    if (!pat.trim()) return;
    setError(null);
    setFailure(null);
    setPatBusy(true);
    try {
      await ipc.githubSavePat(pat.trim());
      setPat("");
      setShowPatInput(false);
      await client.invalidateQueries({ queryKey: githubStatusKey });
    } catch (cause: unknown) {
      setError(toIpcError(cause));
    } finally {
      setPatBusy(false);
    }
  };

  if (status.isPending) return <p className="text-fg-muted">Checking GitHub…</p>;
  if (status.isError) {
    return (
      <>
        <ErrorNotice title="Could not check the GitHub account" error={status.error} />
        <Button onClick={() => void status.refetch()}>Retry</Button>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {status.data.account !== null ? (
        <div className="flex items-center gap-3">
          <p className="text-sm">
            Signed in as <span className="font-mono font-medium">{status.data.account.login}</span>
          </p>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      ) : code !== null ? (
        <div role="status" className="space-y-2 text-sm">
          <p>
            On <span data-selectable className="font-mono">{code.verification_uri}</span> enter this code:
          </p>
          <p data-selectable className="font-mono text-lg tracking-widest">
            {code.user_code}
          </p>
          <p className="text-fg-muted">Waiting for you to approve RustGit on GitHub…</p>
          <Button onClick={() => void cancel()}>Cancel</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">
            RustGit automatically connects to logins detected on your machine from GitHub CLI, Git Credential Manager, or GitHub Desktop.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {status.data.configured && (
              <Button variant="primary" onClick={() => void start()}>
                Sign in with browser
              </Button>
            )}
            <Button variant={status.data.configured ? "ghost" : "primary"} onClick={() => setShowPatInput((prev) => !prev)}>
              {showPatInput ? "Cancel token entry" : "Use Personal Access Token"}
            </Button>
          </div>
          {showPatInput && (
            <div className="space-y-2 rounded border border-border bg-subtle p-3 text-sm">
              <label htmlFor="github-pat-input" className="block text-xs font-medium text-fg-secondary">
                Personal Access Token (classic or fine-grained)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="github-pat-input"
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_... or github_pat_..."
                  className="flex-1 rounded border border-border bg-input px-2.5 py-1 font-mono text-xs text-fg focus:border-accent focus:outline-none"
                  disabled={patBusy}
                />
                <Button variant="primary" disabled={patBusy || !pat.trim()} onClick={() => void savePat()}>
                  {patBusy ? "Verifying…" : "Save token"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {failure !== null && <p className="text-sm text-danger">Sign-in did not finish: {failure}</p>}
      {error !== null && <ErrorNotice title="GitHub sign-in failed" error={error} />}
    </div>
  );
}
