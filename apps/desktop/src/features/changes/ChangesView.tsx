import { useDeferredValue, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { Splitter } from "../../components/Splitter";
import { InspectorToggle, WorkspaceLayout } from "../../app/WorkspaceLayout";
import { useRepositoryStatus, useStaging } from "../../services/queries";
import type { FileStatus } from "../../services/types";
import { usePreferences } from "../../stores/preferences";
import { useWorkspace, type ChangeSelection } from "../../stores/workspace";
import { ChangeTree } from "./ChangeTree";
import { CommitComposer } from "./CommitComposer";
import { DiffCanvas } from "./DiffCanvas";
import { countChanges } from "./changeLabels";

/**
 * Changes: the integrated navigator (every file once, index and tree
 * state), the diff canvas for the selected file, and the composer for the
 * next commit as the contextual inspector.
 */
export function ChangesView({ repositoryId }: { repositoryId: number }) {
  const status = useRepositoryStatus(repositoryId);
  const staging = useStaging(repositoryId);
  const selection: ChangeSelection | null = useWorkspace((state) => state.selectedChange);
  const selectChange = useWorkspace((state) => state.selectChange);
  const listWidth: number = usePreferences((state) => state.sizes.fileList);
  const [query, setQuery] = useState<string>("");
  // Filtering thousands of paths never blocks typing.
  const deferredQuery: string = useDeferredValue(query);

  const files: FileStatus[] = status.data?.files ?? [];
  const selectedFile: FileStatus | undefined =
    selection === null ? undefined : files.find((file: FileStatus) => file.path === selection.path);
  const counts = countChanges(files);
  const anyUnstaged: boolean = files.some((file) => !file.conflicted && file.unstaged !== null);
  const anyStaged: boolean = counts.staged > 0;

  const toggleStage = (file: FileStatus): void => {
    if (file.unstaged !== null) staging.mutate({ kind: "stage", paths: [file.path] });
    else if (file.staged !== null) staging.mutate({ kind: "unstage", paths: [file.path] });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Changes"
        subtitle={
          status.data === undefined
            ? undefined
            : `${counts.staged} staged · ${counts.unstaged} unstaged · ${counts.untracked} untracked${
                counts.conflicted > 0 ? ` · ${counts.conflicted} conflicted` : ""
              }`
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
      <WorkspaceLayout inspector={status.data === undefined ? null : <CommitComposer repositoryId={repositoryId} status={status.data} />}>
        <div className="flex min-h-0 flex-1">
          <section aria-label="Changed files" style={{ width: listWidth }} className="flex shrink-0 flex-col bg-surface">
            <div className="flex h-11 shrink-0 items-center gap-2 px-4">
              <label className="flex min-w-0 flex-1 items-center gap-2 border-b border-border focus-within:border-accent">
                <Search aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                <span className="sr-only">Filter changed files</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="filter"
                  className="rg-control min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
                />
              </label>
              <span aria-hidden className="flex w-10 shrink-0 justify-between font-mono text-2xs text-fg-muted" title="index · working tree">
                <span>idx</span>
                <span>wt</span>
              </span>
            </div>
            <div className="flex shrink-0 gap-1 px-3 pb-2">
              <Button variant="ghost" disabled={!anyUnstaged || staging.isPending} onClick={() => staging.mutate({ kind: "stage_all" })}>
                Stage all
              </Button>
              <Button variant="ghost" disabled={!anyStaged || staging.isPending} onClick={() => staging.mutate({ kind: "unstage_all" })}>
                Unstage all
              </Button>
            </div>
            {status.isPending && <p className="px-5 py-4 text-fg-muted">Reading status…</p>}
            {status.isError && (
              <div className="p-3">
                <ErrorNotice title="Could not read status" error={status.error} />
              </div>
            )}
            {status.data !== undefined && (
              <ChangeTree
                files={files}
                query={deferredQuery}
                selectedPath={selection?.path ?? null}
                onSelect={(path: string) => selectChange({ path, side: "unstaged" })}
                onToggleStage={toggleStage}
                onUnstage={(file: FileStatus) => staging.mutate({ kind: "unstage", paths: [file.path] })}
                busy={staging.isPending}
              />
            )}
          </section>
          <Splitter panel="fileList" label="Resize file list" grows="right" />
          {selectedFile !== undefined ? (
            <DiffCanvas key={selectedFile.path} repositoryId={repositoryId} file={selectedFile} />
          ) : (
            <div className="rg-canvas flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-fg-secondary">
                {selection !== null ? "This file no longer has changes." : files.length > 0 ? "Select a file to read its diff." : "Nothing to review."}
              </p>
              {files.length > 0 && (
                <p className="text-sm text-fg-muted">↑ ↓ move between files · Space stages or unstages · u unstages</p>
              )}
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </div>
  );
}
