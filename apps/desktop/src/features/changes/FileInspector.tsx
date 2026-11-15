import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../../components/Button";
import type { ChangeKind, FileStatus } from "../../services/types";
import type { ChangeSelection } from "../../stores/workspace";
import { CHANGE_LABELS, isPartiallyStaged, splitPath } from "./changeLabels";

/** Compact state badges for the selected file header. Text, not color, carries the meaning. */
export function StateBadges({ file }: { file: FileStatus }) {
  if (file.conflicted) {
    return <Badge tone="text-danger border-danger/60">conflicted</Badge>;
  }
  return (
    <span className="flex items-center gap-1">
      {file.staged !== null && <Badge tone="text-accent border-accent/50">staged · {CHANGE_LABELS[file.staged].label.toLowerCase()}</Badge>}
      {file.unstaged !== null && (
        <Badge tone="text-amber border-amber/50">
          {file.unstaged === "untracked" ? "untracked" : `unstaged · ${CHANGE_LABELS[file.unstaged].label.toLowerCase()}`}
        </Badge>
      )}
    </span>
  );
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`rounded-xs border px-1.5 font-mono text-2xs leading-4 ${tone}`}>{children}</span>;
}

export function FileInspector({ file, selection }: { file: FileStatus | undefined; selection: ChangeSelection }) {
  const { name, directory } = splitPath(selection.path);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-divider px-3 py-2.5">
        <p className="rg-label">File</p>
        <p data-selectable className="mt-1 break-all font-mono text-sm text-fg">
          {name}
        </p>
        {directory !== "" && (
          <p data-selectable className="break-all font-mono text-xs text-fg-muted">
            {directory}/
          </p>
        )}
        <div className="mt-2">
          <CopyPathButton path={selection.path} />
        </div>
      </header>

      {file === undefined ? (
        <p className="px-3 py-3 text-sm text-fg-muted">This file no longer has changes.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 px-3 py-3 text-sm">
            {file.originalPath !== null && (
              <Field label="Renamed from">
                <span data-selectable className="break-all font-mono text-xs">
                  {file.originalPath}
                </span>
              </Field>
            )}
            <Field label="Index">
              <SideState kind={file.conflicted ? null : file.staged} empty="No staged changes" />
            </Field>
            <Field label="Working tree">
              {file.conflicted ? (
                <span className="text-danger">Unresolved merge conflict</span>
              ) : (
                <SideState kind={file.unstaged} empty="Matches the index" />
              )}
            </Field>
          </dl>
          {isPartiallyStaged(file) && (
            <p className="mx-3 mb-3 border-l-2 border-amber pl-2.5 text-sm text-fg-secondary">
              <span className="font-medium text-amber">Partially staged.</span> Some changes in this file are in the
              index and will be committed; others are not. Both appear in the file list.
            </p>
          )}
          {file.conflicted && (
            <p className="mx-3 mb-3 border-l-2 border-danger pl-2.5 text-sm text-fg-secondary">
              Git could not merge this file automatically. It must be resolved before the merge can be committed.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function SideState({ kind, empty }: { kind: ChangeKind | null; empty: string }) {
  if (kind === null) {
    return <span className="text-fg-muted">{empty}</span>;
  }
  const meta = CHANGE_LABELS[kind];
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`font-mono text-xs font-semibold ${meta.tone}`}>
        {meta.letter}
      </span>
      {meta.label}
    </span>
  );
}

function CopyPathButton({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") {
      return;
    }
    const timer: number = window.setTimeout(() => setState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = (): void => {
    navigator.clipboard.writeText(path).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <Button onClick={copy} aria-live="polite">
      {state === "copied" ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy path"}
    </Button>
  );
}
