import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { useRepositories, useRepositoryStatus } from "../../services/queries";
import type { BranchStatus, RepositoryEntry, StatusSnapshot } from "../../services/types";
import { useWorkspace } from "../../stores/workspace";
import { countChanges, type StatusCounts } from "../changes/changeLabels";

export function OverviewView({ repositoryId }: { repositoryId: number }) {
  const repositories = useRepositories();
  const status = useRepositoryStatus(repositoryId);
  const showSection = useWorkspace((state) => state.showSection);
  const repository: RepositoryEntry | undefined = repositories.data?.find(
    (entry: RepositoryEntry) => entry.id === repositoryId,
  );
  const counts: StatusCounts | null = status.data === undefined ? null : countChanges(status.data.files);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Overview"
        actions={
          <Button variant="ghost" onClick={() => void status.refetch()} disabled={status.isFetching}>
            <RefreshCw aria-hidden className={`size-3.5 ${status.isFetching ? "motion-safe:animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status.isPending && <p className="p-4 text-fg-muted">Reading repository…</p>}
        {status.isError && (
          <div className="p-4">
            <ErrorNotice title="Could not read repository status" error={status.error} />
          </div>
        )}
        {status.data !== undefined && counts !== null && (
          <div className="max-w-4xl space-y-px px-4 pt-4">
            <p data-selectable className="px-4 pb-2 font-mono text-xs text-fg-muted">
              {repository?.path}
            </p>
            <Panel label="Head">
              <BranchSummary branch={status.data.branch} />
            </Panel>
            <Panel label="Working tree">
              <dl className="grid grid-cols-2 border-y border-divider sm:grid-cols-4">
                <Metric label="Staged" value={counts.staged} tone={counts.staged > 0 ? "text-accent" : ""} />
                <Metric label="Unstaged" value={counts.unstaged} tone={counts.unstaged > 0 ? "text-amber" : ""} />
                <Metric label="Untracked" value={counts.untracked} />
                <Metric label="Conflicted" value={counts.conflicted} tone={counts.conflicted > 0 ? "text-danger" : ""} />
              </dl>
              <div className="flex items-center gap-3 pt-3">
                {status.data.files.length > 0 ? (
                  <Button onClick={() => showSection("changes")}>Review changes</Button>
                ) : (
                  <p className="text-sm text-success">Working tree clean. Nothing to commit.</p>
                )}
              </div>
            </Panel>
            <Notes snapshot={status.data} counts={counts} />
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="px-4 py-4">
      <h2 className="rg-label mb-3">{label.toLowerCase()}</h2>
      {children}
    </section>
  );
}

function BranchSummary({ branch }: { branch: BranchStatus }) {
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5 text-sm">
      <Row label="Branch">
        {branch.head ?? <span className="text-amber">Detached HEAD</span>}
      </Row>
      <Row label="Commit">{branch.oid === null ? <span className="text-fg-muted">No commits yet</span> : branch.oid.slice(0, 12)}</Row>
      <Row label="Upstream">
        {branch.upstream === null ? (
          <span className="font-sans text-fg-muted">Not tracking a remote branch</span>
        ) : (
          <span className="flex items-center gap-3">
            {branch.upstream}
            <span className="flex items-center gap-2 tabular-nums" title="As of the last fetch">
              <span className={`flex items-center ${branch.ahead > 0 ? "text-accent" : "text-fg-muted"}`}>
                <ArrowUp aria-hidden className="size-3" />
                {branch.ahead} ahead
              </span>
              <span className={`flex items-center ${branch.behind > 0 ? "text-amber" : "text-fg-muted"}`}>
                <ArrowDown aria-hidden className="size-3" />
                {branch.behind} behind
              </span>
            </span>
          </span>
        )}
      </Row>
    </dl>
  );
}

/** Short explanations for states that need attention. Each is derived from the status above. */
function Notes({ snapshot, counts }: { snapshot: StatusSnapshot; counts: StatusCounts }) {
  const notes: Array<{ tone: "danger" | "warning"; text: string }> = [];
  if (counts.conflicted > 0) {
    notes.push({
      tone: "danger",
      text: `${counts.conflicted} file${counts.conflicted === 1 ? " has" : "s have"} merge conflicts. Resolve them before committing.`,
    });
  }
  if (snapshot.branch.head === null && snapshot.branch.oid !== null) {
    notes.push({
      tone: "warning",
      text: "HEAD is detached: you are on a commit, not a branch. New commits will not belong to any branch unless you create one.",
    });
  }
  if (snapshot.branch.upstream !== null && snapshot.branch.behind > 0 && snapshot.branch.ahead > 0) {
    notes.push({
      tone: "warning",
      text: "This branch and its upstream have diverged. Pulling will merge or rebase the two lines of work.",
    });
  }
  if (notes.length === 0) {
    return null;
  }
  return (
    <Panel label="Attention">
      <ul className="space-y-1.5">
        {notes.map((note) => (
          <li key={note.text} className="flex gap-2 text-sm text-fg-secondary">
            {note.tone === "danger" ? (
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
            ) : (
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber" />
            )}
            {note.text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd data-selectable className="min-w-0 truncate font-mono">
        {children}
      </dd>
    </>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border-divider py-2 pr-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:pl-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={`font-mono text-lg tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
