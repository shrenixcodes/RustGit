import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { useRepositories, useRepositoryStatus } from "../../services/queries";
import type { BranchStatus, RepositoryEntry } from "../../services/types";
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
        title={repository?.name ?? "Repository"}
        subtitle={<span className="font-mono">{repository?.path}</span>}
        actions={
          <Button onClick={() => void status.refetch()} disabled={status.isFetching}>
            <RefreshCw aria-hidden className={`size-3.5 ${status.isFetching ? "motion-safe:animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <div className="space-y-4 overflow-y-auto p-4">
        {status.isPending && <p className="text-fg-muted">Reading repository…</p>}
        {status.isError && <ErrorNotice title="Could not read repository status" error={status.error} />}
        {status.data !== undefined && counts !== null && (
          <>
            <BranchSummary branch={status.data.branch} />
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              <Metric label="Staged" value={counts.staged} />
              <Metric label="Unstaged" value={counts.unstaged} />
              <Metric label="Untracked" value={counts.untracked} />
              <Metric label="Conflicted" value={counts.conflicted} tone={counts.conflicted > 0 ? "text-danger" : ""} />
            </dl>
            {status.data.files.length > 0 && (
              <Button onClick={() => showSection("changes")}>Review changes</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BranchSummary({ branch }: { branch: BranchStatus }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 rounded-md border border-border bg-surface p-3">
      <Row label="Branch">
        {branch.head ?? <span className="text-warning">Detached HEAD</span>}
      </Row>
      <Row label="Commit">{branch.oid === null ? "No commits yet" : branch.oid.slice(0, 12)}</Row>
      <Row label="Upstream">
        {branch.upstream === null ? (
          <span className="text-fg-muted">Not tracking a remote branch</span>
        ) : (
          <>
            {branch.upstream}
            <span className="ml-3 tabular-nums text-fg-muted">
              ↑{branch.ahead} ↓{branch.behind}
            </span>
          </>
        )}
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd data-selectable className="min-w-0 truncate font-mono text-sm">
        {children}
      </dd>
    </>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
