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

  if (status.isPending) return <p className="text-fg-muted">Checking GitHub…</p>;
  if (status.isError) {
    return (
      <>
        <ErrorNotice title="Could not check the GitHub account" error={status.error} />
        <Button onClick={() => void status.refetch()}>Retry</Button>
      </>
    );
  }
  if (!status.data.configured) {
    return (
      <p className="text-sm text-fg-muted">
        This build has no GitHub OAuth client id, so GitHub sign-in is unavailable. Git itself still works with the credential
        helper and the prompts RustGit shows.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {status.data.account !== null ? (
        <div className="flex items-center gap-3">
          <p className="text-sm">
            Signed in as <span className="font-mono">{status.data.account.login}</span>
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
        <Button variant="primary" onClick={() => void start()}>
          Sign in to GitHub
        </Button>
      )}
      {failure !== null && <p className="text-sm text-danger">Sign-in did not finish: {failure}</p>}
      {error !== null && <ErrorNotice title="GitHub sign-in failed" error={error} />}
    </div>
  );
}
