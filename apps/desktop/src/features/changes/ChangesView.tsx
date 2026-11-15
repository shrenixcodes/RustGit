import { RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { useRepositoryStatus } from "../../services/queries";
import type { ChangeKind, FileStatus } from "../../services/types";
import { CHANGE_LABELS, splitChanges, type SplitChanges } from "./changeLabels";

export function ChangesView({ repositoryId }: { repositoryId: number }) {
  const status = useRepositoryStatus(repositoryId);
  const groups: SplitChanges | null = status.data === undefined ? null : splitChanges(status.data.files);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Changes"
        subtitle="Working tree status. Staging and committing are not available yet."
        actions={
          <Button onClick={() => void status.refetch()} disabled={status.isFetching}>
            <RefreshCw aria-hidden className={`size-3.5 ${status.isFetching ? "motion-safe:animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {status.isPending && <p className="text-fg-muted">Reading status…</p>}
        {status.isError && <ErrorNotice title="Could not read status" error={status.error} />}
        {groups !== null &&
          groups.conflicted.length + groups.staged.length + groups.unstaged.length === 0 && (
            <p className="text-fg-muted">No changes. The working tree is clean.</p>
          )}
        {groups !== null && (
          <>
            <FileGroup title="Conflicted" files={groups.conflicted} side="unstaged" />
            <FileGroup title="Staged" files={groups.staged} side="staged" />
            <FileGroup title="Unstaged" files={groups.unstaged} side="unstaged" />
          </>
        )}
      </div>
    </div>
  );
}

interface FileGroupProps {
  title: string;
  files: FileStatus[];
  side: "staged" | "unstaged";
}

function FileGroup({ title, files, side }: FileGroupProps) {
  if (files.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg-secondary">
        {title}
        <span className="tabular-nums text-fg-muted">{files.length}</span>
      </h2>
      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {files.map((file: FileStatus) => {
          const kind: ChangeKind | null = file[side];
          const meta = kind === null ? null : CHANGE_LABELS[kind];
          return (
            <li key={`${side}:${file.path}`} className="flex items-center gap-2.5 px-3 py-1.5">
              <span
                title={meta?.label}
                aria-label={meta?.label}
                className={`w-3 shrink-0 text-center font-mono text-xs font-medium ${meta?.tone ?? ""}`}
              >
                {meta?.letter}
              </span>
              <span data-selectable className="min-w-0 flex-1 truncate font-mono text-sm">
                {file.originalPath !== null && <span className="text-fg-muted">{file.originalPath} → </span>}
                {file.path}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
