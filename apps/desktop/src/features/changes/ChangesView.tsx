import { useDeferredValue, useState } from "react";
import { FileDiff, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { Splitter } from "../../components/Splitter";
import { InspectorToggle, WorkspaceLayout } from "../../app/WorkspaceLayout";
import { useRepositoryStatus } from "../../services/queries";
import type { FileStatus } from "../../services/types";
import { usePreferences } from "../../stores/preferences";
import { useWorkspace, type ChangeSelection } from "../../stores/workspace";
import { ChangeTree } from "./ChangeTree";
import { FileInspector, StateBadges } from "./FileInspector";
import { countChanges, splitPath } from "./changeLabels";

export function ChangesView({ repositoryId }: { repositoryId: number }) {
  const status = useRepositoryStatus(repositoryId);
  const selection: ChangeSelection | null = useWorkspace((state) => state.selectedChange);
  const selectChange = useWorkspace((state) => state.selectChange);
  const listWidth: number = usePreferences((state) => state.sizes.fileList);
  const [query, setQuery] = useState<string>("");
  // Filtering thousands of paths stays responsive: typing is never blocked by the list.
  const deferredQuery: string = useDeferredValue(query);

  const files: FileStatus[] = status.data?.files ?? [];
  const selectedFile: FileStatus | undefined =
    selection === null ? undefined : files.find((file: FileStatus) => file.path === selection.path);
  const counts = countChanges(files);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Changes"
        subtitle={
          status.data === undefined ? undefined : (
            <span className="font-mono tabular-nums">
              {counts.staged} staged · {counts.unstaged} unstaged · {counts.untracked} untracked
              {counts.conflicted > 0 && <span className="text-danger"> · {counts.conflicted} conflicted</span>}
            </span>
          )
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => void status.refetch()} disabled={status.isFetching}>
              <RefreshCw aria-hidden className={`size-3.5 ${status.isFetching ? "motion-safe:animate-spin" : ""}`} />
              Refresh
            </Button>
            <InspectorToggle />
          </>
        }
      />
      <WorkspaceLayout
        inspector={
          selection === null ? null : (
            <FileInspector file={selectedFile} selection={selection} />
          )
        }
      >
        <div className="flex min-h-0 flex-1">
          <section aria-label="Changed files" style={{ width: listWidth }} className="flex shrink-0 flex-col bg-surface">
            <label className="flex h-8 shrink-0 items-center gap-2 border-b border-divider px-2.5">
              <Search aria-hidden className="size-3.5 text-fg-muted" />
              <span className="sr-only">Filter changed files</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter files"
                className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted"
              />
            </label>
            {status.isPending && <p className="px-3 py-4 text-fg-muted">Reading status…</p>}
            {status.isError && (
              <div className="p-2">
                <ErrorNotice title="Could not read status" error={status.error} />
              </div>
            )}
            {status.data !== undefined && (
              <ChangeTree files={files} query={deferredQuery} selection={selection} onSelect={selectChange} />
            )}
          </section>
          <Splitter panel="fileList" label="Resize file list" grows="right" />
          <SelectedFilePane file={selectedFile} selection={selection} hasChanges={files.length > 0} />
        </div>
      </WorkspaceLayout>
    </div>
  );
}

function SelectedFilePane({
  file,
  selection,
  hasChanges,
}: {
  file: FileStatus | undefined;
  selection: ChangeSelection | null;
  hasChanges: boolean;
}) {
  if (selection === null) {
    return (
      <div className="rg-canvas flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-center">
        <FileDiff aria-hidden className="size-5 text-fg-muted" />
        <p className="text-fg-secondary">{hasChanges ? "Select a file to inspect it." : "Nothing to review."}</p>
        {hasChanges && <p className="text-sm text-fg-muted">Use ↑ ↓ in the file list to move between files.</p>}
      </div>
    );
  }

  const { name, directory } = splitPath(selection.path);
  return (
    <section aria-label="Selected file" className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-divider bg-bg px-3">
        <span className="truncate font-mono text-sm text-fg">{name}</span>
        <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{directory}</span>
        <span className="flex-1" />
        {file !== undefined && <StateBadges file={file} />}
      </header>
      <div className="rg-canvas flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
        {file === undefined ? (
          <>
            <p className="text-fg-secondary">This file no longer has changes.</p>
            <p className="text-sm text-fg-muted">It was committed, reverted or staged elsewhere since the last refresh.</p>
          </>
        ) : (
          <>
            <p className="text-fg-secondary">The diff for this file cannot be shown yet.</p>
            <p className="max-w-md text-sm text-fg-muted">
              Viewing diffs and staging files, hunks or lines will be enabled once the Git backend provides them. The
              file's status is shown in the inspector.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
