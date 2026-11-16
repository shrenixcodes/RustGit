import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { ipc, type IpcError } from "../../services/ipc";
import { useGithubStatus } from "../../services/github";
import type { GithubRepository } from "../../services/types";

/** Case-insensitive match on the owner/name and description. */
export function filterGithubRepositories(repositories: readonly GithubRepository[], query: string): GithubRepository[] {
  const needle: string = query.trim().toLowerCase();
  if (needle === "") return [...repositories];
  return repositories.filter(
    (repository) =>
      repository.fullName.toLowerCase().includes(needle) || (repository.description ?? "").toLowerCase().includes(needle),
  );
}

/**
 * Pick one of the signed-in account's repositories to clone. Shows nothing
 * when GitHub sign-in is unavailable or the person is signed out.
 */
export function GithubRepositoryPicker({ onPick }: { onPick: (cloneUrl: string, name: string) => void }) {
  const status = useGithubStatus();
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const signedIn: boolean = status.data?.account != null;
  const repositories = useQuery<GithubRepository[], IpcError>({
    queryKey: ["github-repositories"],
    queryFn: () => ipc.githubListRepositories(1),
    enabled: open && signedIn,
    staleTime: 60_000,
    retry: false,
  });
  const shown: GithubRepository[] = useMemo(
    () => filterGithubRepositories(repositories.data ?? [], query),
    [repositories.data, query],
  );

  if (!signedIn) return null;
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="self-start">
        Choose from GitHub…
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="rg-label">your repositories</span>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or description"
          className="mt-1 h-8 w-full border-b border-border bg-transparent text-sm outline-none focus:border-accent"
        />
      </label>
      {repositories.isPending && <p className="text-sm text-fg-muted">Loading your repositories…</p>}
      {repositories.isError && <ErrorNotice title="Could not list GitHub repositories" error={repositories.error} />}
      {repositories.isSuccess && shown.length === 0 && <p className="text-sm text-fg-muted">No matching repositories.</p>}
      <ul className="max-h-56 divide-y divide-divider overflow-y-auto">
        {shown.map((repository) => (
          <li key={repository.fullName}>
            <button
              type="button"
              onClick={() => {
                onPick(repository.cloneUrl, repository.fullName.split("/").pop() ?? repository.fullName);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-1 py-1.5 text-left hover:bg-hover"
            >
              <span className="font-mono text-sm">
                {repository.fullName}
                {repository.private && <span className="ml-2 text-xs text-fg-muted">private</span>}
              </span>
              {repository.description !== null && repository.description !== "" && (
                <span className="text-xs text-fg-muted">{repository.description}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Close list
      </Button>
    </div>
  );
}
