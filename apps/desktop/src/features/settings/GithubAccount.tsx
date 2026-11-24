import { useCallback, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, LogOut, ShieldCheck } from "lucide-react";
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
  const [codeCopied, setCodeCopied] = useState(false);

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

  const copyCode = (val: string) => {
    void navigator.clipboard?.writeText(val).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  if (status.isPending) return <p className="text-xs text-fg-muted">Checking GitHub connection…</p>;
  if (status.isError) {
    return (
      <div className="space-y-2">
        <ErrorNotice title="Could not check the GitHub account" error={status.error} />
        <Button onClick={() => void status.refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {status.data.account !== null ? (
        <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 p-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-success/20 text-success">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-fg">
                Signed in as <span className="font-mono font-semibold text-fg">@{status.data.account.login}</span>
              </p>
              <p className="text-2xs text-fg-muted">Credentials securely stored in system keychain</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => void signOut()} className="h-7 text-xs text-danger/80 hover:bg-danger/10 hover:text-danger">
            <LogOut className="size-3 mr-1" />
            Sign out
          </Button>
        </div>
      ) : code !== null ? (
        <div role="status" className="space-y-3 rounded-lg border border-accent/40 bg-accent/10 p-4 shadow-2xs text-xs">
          <p className="text-fg-secondary">
            On <span data-selectable className="font-mono font-semibold text-accent underline">{code.verification_uri}</span> enter this code:
          </p>
          <div className="flex items-center gap-3">
            <span data-selectable className="rounded-lg border border-accent/30 bg-canvas/80 px-4 py-2 font-mono text-lg font-bold tracking-widest text-accent">
              {code.user_code}
            </span>
            <Button variant="secondary" onClick={() => copyCode(code.user_code)}>
              {codeCopied ? <Check className="size-3 text-success mr-1" /> : <Copy className="size-3 mr-1" />}
              {codeCopied ? "Copied" : "Copy code"}
            </Button>
          </div>
          <p className="text-2xs text-fg-muted">Waiting for you to approve RustGit on GitHub…</p>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="ghost" onClick={() => void cancel()} className="h-7 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-2xs text-fg-muted leading-relaxed">
            RustGit automatically connects to logins detected on your machine from GitHub CLI, Git Credential Manager, or GitHub Desktop.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {status.data.configured && (
              <Button variant="primary" onClick={() => void start()}>
                <ExternalLink className="size-3.5 mr-1" />
                Sign in with browser
              </Button>
            )}
            <Button variant={status.data.configured ? "ghost" : "primary"} onClick={() => setShowPatInput((prev) => !prev)}>
              <KeyRound className="size-3.5 mr-1" />
              {showPatInput ? "Cancel token entry" : "Use Personal Access Token"}
            </Button>
          </div>
          {showPatInput && (
            <div className="space-y-2 rounded-lg border border-border/80 bg-canvas/60 p-3.5 text-xs shadow-2xs">
              <label htmlFor="github-pat-input" className="block text-2xs font-semibold uppercase tracking-wider text-fg-secondary">
                Personal Access Token (classic or fine-grained)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="github-pat-input"
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_... or github_pat_..."
                  className="h-8 flex-1 rounded-lg border border-border/80 bg-canvas px-2.5 font-mono text-xs text-fg focus:border-accent focus:outline-none"
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
      {failure !== null && <p className="text-xs font-medium text-danger">Sign-in did not finish: {failure}</p>}
      {error !== null && <ErrorNotice title="GitHub sign-in failed" error={error} />}
    </div>
  );
}
