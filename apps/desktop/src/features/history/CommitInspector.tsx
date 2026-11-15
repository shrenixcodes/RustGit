import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Crosshair, GitMerge } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { useCommitDetails } from "../../services/queries";
import type { CommitFile, HeadState, RefEntry } from "../../services/types";
import { CHANGE_LABELS, splitPath } from "../changes/changeLabels";
import { RefBadges } from "./RefBadges";
import { formatAbsolute, formatRelative } from "./time";

interface CommitInspectorProps {
  repositoryId: number;
  oid: string;
  refs: readonly RefEntry[];
  head: HeadState | undefined;
  onSelectCommit: (oid: string) => void;
  /** Present while showing search results: clears the search and reveals the commit in the graph. */
  onShowInGraph: ((oid: string) => void) | null;
}

export function CommitInspector({ repositoryId, oid, refs, head, onSelectCommit, onShowInGraph }: CommitInspectorProps) {
  const details = useCommitDetails(repositoryId, oid);
  const detachedHere: boolean = head?.kind === "detached" && head.oid === oid;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="space-y-3 px-5 pt-4 pb-3">
        <p className="rg-label">commit</p>
        <div className="flex items-center gap-2">
          <span data-selectable className="min-w-0 break-all font-mono text-xs text-accent">
            {oid}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CopyButton value={oid} label="Copy SHA" />
          {onShowInGraph !== null && (
            <Button onClick={() => onShowInGraph(oid)}>
              <Crosshair aria-hidden className="size-3.5" /> Show in graph
            </Button>
          )}
        </div>
        {(refs.length > 0 || detachedHere) && (
          <div className="flex flex-wrap gap-1">
            <RefBadges refs={refs} head={head} detachedHead={detachedHere} max={12} />
          </div>
        )}
      </header>

      {details.isPending && <p className="px-5 py-3 text-sm text-fg-muted">Reading commit…</p>}
      {details.isError && (
        <div className="p-3">
          <ErrorNotice title="Could not read commit" error={details.error} />
        </div>
      )}
      {details.data !== undefined && (
        <>
          <section aria-label="Message" className="px-5 py-3">
            <MessageView message={details.data.message} />
          </section>

          <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2 px-5 py-3 text-sm">
            <Field label="Author">
              <Person name={details.data.authorName} email={details.data.authorEmail} time={details.data.authorTime} />
            </Field>
            {(details.data.committerName !== details.data.authorName ||
              details.data.committerEmail !== details.data.authorEmail ||
              details.data.committerTime !== details.data.authorTime) && (
              <Field label="Committer">
                <Person
                  name={details.data.committerName}
                  email={details.data.committerEmail}
                  time={details.data.committerTime}
                />
              </Field>
            )}
            <Field label={details.data.parents.length > 1 ? "Parents" : "Parent"}>
              {details.data.parents.length === 0 ? (
                <span className="text-fg-muted">None (root commit)</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {details.data.parents.map((parent: string, index: number) => (
                    <button
                      key={parent}
                      type="button"
                      onClick={() => onSelectCommit(parent)}
                      title={index === 0 ? "First parent" : `Parent ${index + 1} (merged in)`}
                      className="rounded-xs border border-border px-1 font-mono text-xs text-fg-secondary hover:border-accent hover:text-accent"
                    >
                      {parent.slice(0, 7)}
                    </button>
                  ))}
                </span>
              )}
            </Field>
          </dl>

          <FileList files={details.data.files} merge={details.data.parents.length > 1} />
        </>
      )}
    </div>
  );
}

function MessageView({ message }: { message: string }) {
  const [summary, ...rest] = message.replace(/\s+$/, "").split("\n");
  const body: string = rest.join("\n").replace(/^\n+/, "");
  return (
    <div data-selectable>
      <p className="font-medium text-fg">{summary}</p>
      {body !== "" && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-fg-secondary">{body}</p>}
    </div>
  );
}

function Person({ name, email, time }: { name: string; email: string; time: number }) {
  return (
    <span data-selectable className="block min-w-0">
      <span className="text-fg">{name}</span> <span className="break-all text-fg-muted">&lt;{email}&gt;</span>
      <span className="block text-xs text-fg-muted" title={formatAbsolute(time)}>
        {formatAbsolute(time)} · {formatRelative(time)}
      </span>
    </span>
  );
}

function FileList({ files, merge }: { files: readonly CommitFile[]; merge: boolean }) {
  const additions: number = files.reduce((sum: number, file: CommitFile) => sum + (file.additions ?? 0), 0);
  const deletions: number = files.reduce((sum: number, file: CommitFile) => sum + (file.deletions ?? 0), 0);
  return (
    <section aria-label="Changed files" className="px-5 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="rg-label">files</h3>
        <span className="font-mono text-2xs tabular-nums text-fg-muted">
          {files.length} · <span className="text-success">+{additions}</span>{" "}
          <span className="text-danger">−{deletions}</span>
        </span>
      </div>
      {merge && (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-fg-muted">
          <GitMerge aria-hidden className="size-3" /> Merge commit: files are compared with the first parent.
        </p>
      )}
      {files.length === 0 ? (
        <p className="text-sm text-fg-muted">No file changes.</p>
      ) : (
        <ul className="space-y-px">
          {files.map((file: CommitFile) => {
            const meta = CHANGE_LABELS[file.kind];
            const { name, directory } = splitPath(file.path);
            return (
              <li
                key={file.path}
                className="flex items-center gap-2 text-sm"
                title={file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`}
              >
                <span aria-label={meta.label} className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${meta.tone}`}>
                  {meta.letter}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="max-w-[70%] shrink-0 truncate">{name}</span>
                  <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" dir="rtl">
                    <bdi dir="ltr">{directory}</bdi>
                  </span>
                </span>
                <span className="shrink-0 font-mono text-2xs tabular-nums">
                  {file.additions === null ? (
                    <span className="text-fg-muted">binary</span>
                  ) : (
                    <>
                      <span className="text-success">+{file.additions}</span>{" "}
                      <span className="text-danger">−{file.deletions ?? 0}</span>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer: number = window.setTimeout(() => setState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <Button
      aria-live="polite"
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => setState("copied"),
          () => setState("failed"),
        )
      }
    >
      {state === "copied" ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}
