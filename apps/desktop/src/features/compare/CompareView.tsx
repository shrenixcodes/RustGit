import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeftRight, GitBranch, GitCompare, GitFork } from "lucide-react";
import { IconButton } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl, type SegmentOption } from "../../components/SegmentedControl";
import { ipc, type IpcError } from "../../services/ipc";
import { queryKeys, useRefs } from "../../services/queries";
import type { CommitFile, Comparison, FileDiff, RefEntry } from "../../services/types";
import { FileEntry, ReadOnlyDiff } from "../../thread/CommitFold";
import { useUi } from "../../stores/ui";
import { useWorkspace } from "../../stores/workspace";

type Mode = "three" | "two";

const MODES: readonly SegmentOption<Mode>[] = [
  { value: "three", label: "Since they diverged" },
  { value: "two", label: "Tree to tree" },
];

/** Compare two revisions: commits on each side and the files that differ (R-16). */
export function CompareView() {
  const repositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Compare" visible />
      {repositoryId === null ? (
        <p className="px-8 text-fg-muted">Open a repository to compare branches.</p>
      ) : (
        <Compare repositoryId={repositoryId} />
      )}
    </div>
  );
}

export function compareSummary(comparison: Comparison, base: string, head: string): string {
  if (comparison.ahead === 0 && comparison.behind === 0) return `${head} and ${base} point at the same history.`;
  const parts: string[] = [];
  if (comparison.ahead > 0) parts.push(`${comparison.ahead} commit${comparison.ahead === 1 ? "" : "s"} in ${head} not in ${base}`);
  if (comparison.behind > 0) parts.push(`${comparison.behind} commit${comparison.behind === 1 ? "" : "s"} in ${base} not in ${head}`);
  return `${parts.join("; ")}.`;
}

function useComparison(repositoryId: number, base: string, head: string, mergeBase: boolean): UseQueryResult<Comparison, IpcError> {
  return useQuery({
    queryKey: [...queryKeys.refs(repositoryId), "compare", base, head, mergeBase],
    queryFn: () => ipc.compareRevisions(repositoryId, base, head, mergeBase),
    enabled: base !== "" && head !== "",
  });
}

function Compare({ repositoryId }: { repositoryId: number }) {
  const request = useUi((state) => state.compare);
  const setCompare = useUi((state) => state.setCompare);
  const refs = useRefs(repositoryId);
  const [mode, setMode] = useState<Mode>("three");
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(new Set());
  const names: string[] = (refs.data?.refs ?? [])
    .filter((entry: RefEntry) => !entry.shortName.endsWith("/HEAD"))
    .map((entry: RefEntry) => entry.shortName);
  const base: string = request?.base ?? "";
  const head: string = request?.head ?? "";
  const mergeBase: boolean = mode === "three";
  const comparison = useComparison(repositoryId, base, head, mergeBase);

  const toggleFile = (path: string): void =>
    setOpenFiles((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const allExpanded: boolean =
    comparison.data !== undefined &&
    comparison.data.files.length > 0 &&
    comparison.data.files.every((file: CommitFile) => openFiles.has(file.path));

  const set = (next: { base: string; head: string }): void => {
    setOpenFiles(new Set());
    setCompare(next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div className="max-w-3xl space-y-5">
        {/* Revision Selector Card */}
        <div className="rounded-xl border border-border/80 bg-elevated/40 p-4 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <span className="flex items-center gap-2 font-medium text-xs text-fg">
              <GitCompare className="size-3.5 text-accent" /> Compare revisions
            </span>
            <SegmentedControl label="Compare files" options={MODES} value={mode} onChange={setMode} />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <RevisionField label="base" value={base} names={names} onChange={(value) => set({ base: value, head })} />
            <div className="pb-1">
              <IconButton label="Swap base and head" onClick={() => set({ base: head, head: base })} className="bg-canvas/80 border border-border/80">
                <ArrowLeftRight aria-hidden className="size-3.5" />
              </IconButton>
            </div>
            <RevisionField label="head" value={head} names={names} onChange={(value) => set({ base, head: value })} />
          </div>
        </div>

        <datalist id="compare-revisions">
          {names.map((name: string) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {(base === "" || head === "") && (
          <EmptyState
            icon={GitFork}
            title="Select revisions to compare"
            description="Choose two branches, tags, or commit SHAs above to inspect commit history differences and file diffs."
          />
        )}

        {comparison.isError && <ErrorNotice title="Could not compare" error={comparison.error} />}
        {comparison.isPending && base !== "" && head !== "" && (
          <p className="py-6 text-center text-sm text-fg-muted">Comparing {base} and {head}…</p>
        )}

        {comparison.data !== undefined && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/80 bg-elevated/50 p-4 shadow-2xs">
              <p role="status" className="font-medium text-xs text-fg leading-relaxed">
                {compareSummary(comparison.data, base, head)}
                {mergeBase && comparison.data.mergeBase === null && (
                  <span className="block mt-1 text-fg-muted font-normal text-2xs">
                    The histories are unrelated; files are compared with an empty tree.
                  </span>
                )}
              </p>
              <div className="mt-2.5 flex items-center gap-2 font-mono text-2xs">
                {comparison.data.ahead > 0 && (
                  <span className="rounded bg-accent/15 border border-accent/25 px-2 py-0.5 text-accent font-semibold">
                    {comparison.data.ahead} ahead
                  </span>
                )}
                {comparison.data.behind > 0 && (
                  <span className="rounded bg-clay/15 border border-clay/25 px-2 py-0.5 text-clay-text font-semibold">
                    {comparison.data.behind} behind
                  </span>
                )}
              </div>
            </div>

            {comparison.data.files.length === 0 ? (
              <p className="text-center py-6 text-xs text-fg-muted">No file differences between these revisions.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="rg-label">
                    {comparison.data.files.length} file{comparison.data.files.length === 1 ? "" : "s"} changed
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenFiles(allExpanded ? new Set() : new Set(comparison.data.files.map((file: CommitFile) => file.path)))
                    }
                    className="rounded-md border border-border/80 bg-canvas/60 px-2.5 py-1 font-sans text-xs font-medium text-accent hover:bg-hover hover:border-accent transition-all cursor-pointer shadow-2xs"
                  >
                    {allExpanded ? "Fold all" : "Expand all"}
                  </button>
                </div>
                <ul aria-label="Changed files" className="space-y-2">
                  {comparison.data.files.map((file: CommitFile) => (
                    <FileEntry
                      key={file.path}
                      file={file}
                      open={openFiles.has(file.path)}
                      onToggle={() => toggleFile(file.path)}
                      diff={() => (
                        <CompareDiff
                          repositoryId={repositoryId}
                          base={comparison.data.base}
                          head={comparison.data.head}
                          mergeBase={mergeBase}
                          file={file}
                        />
                      )}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RevisionField({ label, value, names, onChange }: { label: string; value: string; names: string[]; onChange: (value: string) => void }) {
  const [text, setText] = useState<string>(value);
  const [seen, setSeen] = useState<string>(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const commit = (): void => {
    const next: string = text.trim();
    if (next !== value) onChange(next);
  };
  return (
    <label className="block w-64 min-w-48 flex-1">
      <span className="mb-1 block font-mono text-2xs text-fg-muted uppercase tracking-wider">{label}</span>
      <div className="relative flex h-8 items-center gap-2 rounded-lg border border-border/80 bg-canvas/70 px-2.5 transition-all focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30">
        <GitBranch className="size-3.5 text-fg-muted shrink-0" />
        <input
          list="compare-revisions"
          value={text}
          placeholder={names[0] ?? "branch or commit"}
          onChange={(event) => {
            setText(event.target.value);
            if (names.includes(event.target.value)) onChange(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          className="h-full w-full bg-transparent font-mono text-xs text-fg outline-none placeholder:text-fg-muted/60"
        />
      </div>
    </label>
  );
}

function CompareDiff({
  repositoryId,
  base,
  head,
  mergeBase,
  file,
}: {
  repositoryId: number;
  base: string;
  head: string;
  mergeBase: boolean;
  file: CommitFile;
}) {
  const diff: UseQueryResult<FileDiff, IpcError> = useQuery({
    // Resolved object ids: the diff never changes.
    queryKey: ["compare-diff", repositoryId, base, head, mergeBase, file.path],
    queryFn: () => ipc.compareFileDiff({ id: repositoryId, base, head, mergeBase, path: file.path, originalPath: file.originalPath }),
    staleTime: Infinity,
  });
  return <ReadOnlyDiff diff={diff} />;
}
