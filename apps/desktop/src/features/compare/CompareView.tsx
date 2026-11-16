import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { IconButton } from "../../components/Button";
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
  const [openFile, setOpenFile] = useState<string | null>(null);
  const names: string[] = (refs.data?.refs ?? [])
    .filter((entry: RefEntry) => !entry.shortName.endsWith("/HEAD"))
    .map((entry: RefEntry) => entry.shortName);
  const base: string = request?.base ?? "";
  const head: string = request?.head ?? "";
  const mergeBase: boolean = mode === "three";
  const comparison = useComparison(repositoryId, base, head, mergeBase);

  const set = (next: { base: string; head: string }): void => {
    setOpenFile(null);
    setCompare(next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
      <div className="max-w-3xl space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <RevisionField label="base" value={base} names={names} onChange={(value) => set({ base: value, head })} />
          <IconButton label="Swap base and head" onClick={() => set({ base: head, head: base })}>
            <ArrowLeftRight aria-hidden className="size-3.5" />
          </IconButton>
          <RevisionField label="head" value={head} names={names} onChange={(value) => set({ base, head: value })} />
          <SegmentedControl label="Compare files" options={MODES} value={mode} onChange={setMode} />
        </div>
        <datalist id="compare-revisions">
          {names.map((name: string) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {(base === "" || head === "") && <p className="text-fg-muted">Choose two branches, tags or commit ids.</p>}
        {comparison.isError && <ErrorNotice title="Could not compare" error={comparison.error} />}
        {comparison.isPending && base !== "" && head !== "" && <p className="text-sm text-fg-muted">Comparing…</p>}
        {comparison.data !== undefined && (
          <>
            <p role="status" className="text-sm text-fg-secondary">
              {compareSummary(comparison.data, base, head)}
              {mergeBase && comparison.data.mergeBase === null && " The histories are unrelated; files are compared with an empty tree."}
            </p>
            {comparison.data.files.length === 0 ? (
              <p className="text-fg-muted">No file differences.</p>
            ) : (
              <>
                <p className="rg-label">
                  {comparison.data.files.length} file{comparison.data.files.length === 1 ? "" : "s"} changed
                </p>
                <ul aria-label="Changed files">
                  {comparison.data.files.map((file: CommitFile) => (
                    <FileEntry
                      key={file.path}
                      file={file}
                      open={openFile === file.path}
                      onToggle={() => setOpenFile(openFile === file.path ? null : file.path)}
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
              </>
            )}
          </>
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
    <label className="block w-56">
      <span className="rg-label">{label}</span>
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
        className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
      />
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
