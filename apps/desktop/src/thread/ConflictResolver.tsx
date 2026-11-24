import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorNotice } from "../components/ErrorNotice";
import { SegmentedControl, type SegmentOption } from "../components/SegmentedControl";
import { useConflictVersions, useResolveConflict, type ConflictResolutionRequest } from "../services/queries";
import type { ConflictVersions, InProgress, StatusSnapshot } from "../services/types";
import {
  assemble,
  conflictCount,
  hasConflictMarkers,
  parseConflicts,
  resolveBlock,
  type BlockResolution,
  type Choice,
  type Segment,
} from "./conflicts";

type View = "blocks" | "versions";
const VIEWS: readonly SegmentOption<View>[] = [
  { value: "blocks", label: "Blocks" },
  { value: "versions", label: "Versions" },
];
const CHOICES: readonly SegmentOption<Choice>[] = [
  { value: "ours", label: "Ours" },
  { value: "theirs", label: "Theirs" },
  { value: "both", label: "Both" },
  { value: "both-reversed", label: "Both, theirs first" },
  { value: "custom", label: "Edit" },
];
/** Unchanged lines shown around each conflict; the rest is folded. */
const CONTEXT_LINES = 3;

const ROLE_HINT: Partial<Record<InProgress, string>> = {
  rebasing: "During a rebase, ours is the branch being rebased onto and theirs is the commit being replayed.",
  merging: "Ours is your current branch; theirs is the branch being merged in.",
  cherry_picking: "Ours is your current branch; theirs is the commit being cherry-picked.",
  reverting: "Ours is your current branch; theirs is the reverse of the commit being reverted.",
};

interface ConflictResolverProps {
  repositoryId: number;
  path: string;
  status: StatusSnapshot;
  height: number | string;
  inset?: number;
  onBack: () => void;
}

/**
 * Resolves one conflicted file: each conflict block side by side with a
 * choice, the assembled result, and the full versions for reference. The
 * file counts as resolved only when Git's status says it is no longer
 * conflicted.
 */
export function ConflictResolver({ repositoryId, path, status, height, inset = 72, onBack }: ConflictResolverProps) {
  const versions = useConflictVersions(repositoryId, path);
  return (
    <div
      style={{ height }}
      className="flex flex-col"
      onKeyDown={(event) => {
        // Escape returns to the list of changes (dialogs handle their own Escape).
        if (event.key === "Escape" && !(event.target instanceof HTMLElement && event.target.closest("dialog") !== null)) {
          event.preventDefault();
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <div style={{ paddingLeft: inset }} className="flex shrink-0 items-center gap-3 py-2 pr-5">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden className="size-3.5" /> Changes
        </Button>
        <span className="truncate font-mono text-sm text-fg">{path}</span>
        <span className="font-mono text-xs text-danger">conflicted</span>
      </div>
      {versions.isPending && (
        <p style={{ paddingLeft: inset }} className="py-3 text-sm text-fg-muted">
          Reading the conflict…
        </p>
      )}
      {versions.isError && (
        <div style={{ paddingLeft: inset }} className="pr-5">
          <ErrorNotice title="Could not read the conflict" error={versions.error} />
        </div>
      )}
      {versions.data !== undefined && (
        <Resolver
          // Reset choices only when the conflicted file itself changes, not on every refetch.
          key={contentKey(versions.data.working)}
          repositoryId={repositoryId}
          path={path}
          versions={versions.data}
          inProgress={status.inProgress}
          inset={inset}
          onResolved={onBack}
        />
      )}
    </div>
  );
}

/** Cheap content fingerprint (djb2) for keying the resolver on the conflicted text. */
function contentKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash >>> 0}`;
}

function Resolver({
  repositoryId,
  path,
  versions,
  inProgress,
  inset = 72,
  onResolved,
}: {
  repositoryId: number;
  path: string;
  versions: ConflictVersions;
  inProgress: InProgress;
  inset?: number;
  onResolved: () => void;
}) {
  const resolve = useResolveConflict(repositoryId);
  const segments: Segment[] = useMemo(() => parseConflicts(versions.working), [versions.working]);
  const blocks: number = conflictCount(segments);
  const [view, setView] = useState<View>(blocks > 0 ? "blocks" : "versions");
  const [resolutions, setResolutions] = useState<ReadonlyMap<number, BlockResolution>>(new Map());
  const [manual, setManual] = useState<string | null>(blocks > 0 ? null : versions.working);
  const [confirmMarkers, setConfirmMarkers] = useState<string | null>(null);
  const [stillConflicted, setStillConflicted] = useState<boolean>(false);

  const assembled: string = useMemo(() => assemble(segments, resolutions), [segments, resolutions]);
  const result: string = manual ?? assembled;
  const unresolvedBlocks: number = manual !== null ? (hasConflictMarkers(manual) ? 1 : 0) : blocks - resolutions.size;

  // Any change to the result clears an earlier "still conflicted" answer.
  useEffect(() => setStillConflicted(false), [result]);

  const submit = (request: ConflictResolutionRequest, onSettled?: () => void): void => {
    setStillConflicted(false);
    resolve.mutate(request, {
      onSuccess: (status: StatusSnapshot) => {
        // Trust Git, not the click: the file must have left the conflicted set.
        const entry = status.files.find((file) => file.path === path);
        if (entry?.conflicted === true) setStillConflicted(true);
        else onResolved();
      },
      onSettled: () => onSettled?.(),
    });
  };

  const markResolved = (): void => {
    if (hasConflictMarkers(result)) setConfirmMarkers(result);
    else submit({ path, content: result });
  };

  const choose = (index: number, choice: Choice, segment: Extract<Segment, { kind: "conflict" }>): void =>
    setResolutions((current) => {
      const next: Map<number, BlockResolution> = new Map(current);
      const previous: BlockResolution | undefined = current.get(index);
      // "Edit" starts from what the block currently resolves to.
      const custom: string =
        choice === "custom" ? resolveBlock(segment, previous ?? { choice: "both", custom: "" }) : (previous?.custom ?? "");
      next.set(index, { choice, custom });
      return next;
    });

  const editBlock = (index: number, custom: string): void =>
    setResolutions((current) => new Map(current).set(index, { choice: "custom", custom }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div style={{ paddingLeft: inset }} className="shrink-0 space-y-1 pr-5 pb-2">
        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
          <span>
            <span className="text-fg-muted">ours</span> <span className="text-accent">{versions.oursLabel}</span>
          </span>
          <span>
            <span className="text-fg-muted">theirs</span> <span className="text-indigo-text">{versions.theirsLabel}</span>
          </span>
          {blocks > 0 && (
            <span className={unresolvedBlocks > 0 ? "text-clay-text" : "text-success"}>
              {unresolvedBlocks > 0 ? `${unresolvedBlocks} of ${blocks} conflict${blocks === 1 ? "" : "s"} left` : "every conflict chosen"}
            </span>
          )}
        </p>
        {ROLE_HINT[inProgress] !== undefined && <p className="text-xs text-fg-muted">{ROLE_HINT[inProgress]}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* A side without the file deleted it: taking that side removes the file. */}
          <Button variant="ghost" disabled={resolve.isPending} onClick={() => submit({ path, take: "ours" })}>
            {versions.ours === null ? "Take ours: delete the file" : "Take ours for the whole file"}
          </Button>
          <Button variant="ghost" disabled={resolve.isPending} onClick={() => submit({ path, take: "theirs" })}>
            {versions.theirs === null ? "Take theirs: delete the file" : "Take theirs for the whole file"}
          </Button>
          <span className="flex-1" />
          {!versions.binary && <SegmentedControl label="Conflict view" options={VIEWS} value={view} onChange={setView} />}
        </div>
      </div>

      {versions.binary ? (
        <p style={{ paddingLeft: inset }} className="pr-5 text-sm text-fg-muted">
          This is a binary file: its versions cannot be merged line by line. Take ours or theirs for the whole file.
        </p>
      ) : view === "versions" ? (
        <Versions versions={versions} inset={inset} />
      ) : (
        <div style={{ paddingLeft: inset }} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-5 pb-4">
          {manual === null ? (
            <Blocks segments={segments} resolutions={resolutions} onChoose={choose} onEdit={editBlock} />
          ) : (
            <p className="text-xs text-fg-muted">
              You are editing the whole result; block choices are paused.{" "}
              {blocks > 0 && (
                <button type="button" className="text-accent underline underline-offset-2" onClick={() => setManual(null)}>
                  Return to block choices
                </button>
              )}
            </p>
          )}
          <section aria-label="Result" className="space-y-1.5">
            <div className="flex items-center gap-3">
              <h3 className="rg-label">result</h3>
              {manual === null && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setManual(assembled)}>
                  Edit the whole result
                </button>
              )}
            </div>
            <textarea
              aria-label="Resolved file content"
              readOnly={manual === null}
              value={result}
              onChange={(event) => setManual(event.target.value)}
              spellCheck={false}
              rows={Math.min(24, Math.max(6, result.split("\n").length + 1))}
              className={`w-full resize-y rounded-xs border border-border bg-canvas p-2 font-mono text-xs leading-5 text-fg outline-none focus:border-accent ${
                manual === null ? "text-fg-secondary" : ""
              }`}
              style={{ tabSize: 4 }}
            />
          </section>
        </div>
      )}

      <div style={{ paddingLeft: inset }} className="flex shrink-0 flex-wrap items-center gap-3 border-t border-divider py-2.5 pr-5">
        <Button variant="primary" disabled={resolve.isPending || versions.binary} onClick={markResolved}>
          <Check aria-hidden className="size-3.5" /> Mark resolved
        </Button>
        <span className="text-xs text-fg-muted">
          {unresolvedBlocks > 0 ? "Conflict markers remain in the result." : "Writes the result and stages it; Git confirms the file is no longer conflicted."}
        </span>
        {stillConflicted && (
          <p role="alert" className="w-full text-sm text-danger">
            Git still reports {path} as conflicted, so it was not marked resolved.
          </p>
        )}
        {resolve.error !== null && (
          <div className="w-full">
            <ErrorNotice title="The file was not marked resolved" error={resolve.error} />
          </div>
        )}
      </div>

      {confirmMarkers !== null && (
        <ConfirmDialog
          title="The result still contains conflict markers"
          confirmLabel="Mark resolved anyway"
          destructive
          busy={resolve.isPending}
          onCancel={() => setConfirmMarkers(null)}
          onConfirm={() => submit({ path, content: confirmMarkers }, () => setConfirmMarkers(null))}
        >
          <p>
            Git will accept the file as written, markers included, and they will be committed. Choose a side for each
            remaining conflict unless the markers are intended.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Blocks({
  segments,
  resolutions,
  onChoose,
  onEdit,
}: {
  segments: readonly Segment[];
  resolutions: ReadonlyMap<number, BlockResolution>;
  onChoose: (index: number, choice: Choice, segment: Extract<Segment, { kind: "conflict" }>) => void;
  onEdit: (index: number, custom: string) => void;
}) {
  let conflictIndex = -1;
  return (
    <>
      {segments.map((segment, position) => {
        if (segment.kind === "text") {
          return (
            <Unchanged
              key={`t${position}`}
              text={segment.text}
              leading={position > 0}
              trailing={position < segments.length - 1}
            />
          );
        }
        conflictIndex += 1;
        const index: number = conflictIndex;
        const resolution: BlockResolution | undefined = resolutions.get(index);
        const columns: Array<{ title: string; label: string; text: string; tone: string }> = [
          { title: "ours", label: segment.oursLabel, text: segment.ours, tone: "text-accent" },
          ...(segment.base === null ? [] : [{ title: "base", label: segment.baseLabel ?? "", text: segment.base, tone: "text-fg-muted" }]),
          { title: "theirs", label: segment.theirsLabel, text: segment.theirs, tone: "text-indigo-text" },
        ];
        return (
          <section
            key={`c${position}`}
            aria-label={`Conflict ${index + 1}${resolution === undefined ? ", unresolved" : `, resolved with ${resolution.choice}`}`}
            className={`space-y-2 border-l-2 py-1 pl-3 ${resolution === undefined ? "border-clay" : "border-accent"}`}
          >
            <div className={`grid gap-3 ${columns.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {columns.map((column) => (
                <div key={column.title} className="min-w-0">
                  <p className="mb-1 font-mono text-2xs">
                    <span className={column.tone}>{column.title}</span>{" "}
                    <span className="text-fg-muted">{column.label}</span>
                  </p>
                  <Code text={column.text} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                label={`Resolution for conflict ${index + 1}`}
                options={CHOICES}
                value={resolution?.choice}
                onChange={(choice: Choice) => onChoose(index, choice, segment)}
              />
              {resolution === undefined && <span className="text-xs text-clay-text">unresolved</span>}
            </div>
            {resolution?.choice === "custom" && (
              <textarea
                aria-label={`Edited text for conflict ${index + 1}`}
                value={resolution.custom}
                onChange={(event) => onEdit(index, event.target.value)}
                spellCheck={false}
                rows={Math.min(14, Math.max(3, resolution.custom.split("\n").length + 1))}
                className="w-full resize-y rounded-xs border border-border bg-canvas p-2 font-mono text-xs leading-5 outline-none focus:border-accent"
              />
            )}
          </section>
        );
      })}
    </>
  );
}

/** Unchanged text between conflicts: a few lines of context, the rest folded. */
function Unchanged({ text, leading, trailing }: { text: string; leading: boolean; trailing: boolean }) {
  const [open, setOpen] = useState<boolean>(false);
  const lines: string[] = text.replace(/\n$/, "").split("\n");
  const keep: number = CONTEXT_LINES;
  if (open || lines.length <= keep * 2 + 1) return <Code text={text} muted />;
  const head: string[] = leading ? lines.slice(0, keep) : [];
  const tail: string[] = trailing ? lines.slice(-keep) : [];
  const hidden: number = lines.length - head.length - tail.length;
  return (
    <div>
      {head.length > 0 && <Code text={head.join("\n")} muted />}
      <button type="button" onClick={() => setOpen(true)} className="my-0.5 font-mono text-2xs text-fg-muted hover:text-fg">
        ··· {hidden} unchanged line{hidden === 1 ? "" : "s"}
      </button>
      {tail.length > 0 && <Code text={tail.join("\n")} muted />}
    </div>
  );
}

function Code({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <pre
      data-selectable
      className={`overflow-x-auto rounded-xs bg-canvas px-2 py-1 font-mono text-xs leading-5 ${muted ? "text-fg-muted" : "text-fg"}`}
      style={{ tabSize: 4 }}
    >
      {text === "" ? <span className="italic text-fg-muted">(empty)</span> : text.replace(/\r\n/g, "\n").replace(/\n$/, "")}
    </pre>
  );
}

function Versions({ versions, inset }: { versions: ConflictVersions; inset: number }) {
  const column = (title: string, label: string, text: string | null, tone: string): ReactNode => (
    <div className="flex min-h-0 min-w-0 flex-col">
      <p className="mb-1 shrink-0 font-mono text-2xs">
        <span className={tone}>{title}</span> <span className="text-fg-muted">{label}</span>
      </p>
      {text === null ? (
        <p className="text-sm text-fg-muted">Not present on this side (added or deleted there).</p>
      ) : (
        <pre data-selectable className="min-h-0 flex-1 overflow-auto rounded-xs bg-canvas px-2 py-1 font-mono text-xs leading-5" style={{ tabSize: 4 }}>
          {text}
        </pre>
      )}
    </div>
  );
  return (
    <div style={{ paddingLeft: inset }} className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto pr-5 pb-3 md:grid-cols-3 md:overflow-hidden">
      {column("base", "common ancestor", versions.base, "text-fg-muted")}
      {column("ours", versions.oursLabel, versions.ours, "text-accent")}
      {column("theirs", versions.theirsLabel, versions.theirs, "text-indigo-text")}
    </div>
  );
}
