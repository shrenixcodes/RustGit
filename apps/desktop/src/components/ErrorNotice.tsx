import { useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import type { IpcError } from "../services/ipc";
import type { ErrorKind } from "../services/types";

const HINTS: Partial<Record<ErrorKind, string>> = {
  git_not_found: "Install Git and make sure it is on your PATH, then restart RustGit.",
  not_a_repository: "The folder no longer contains a Git repository. It may have been moved or deleted.",
  invalid_path: "The folder does not exist or is not accessible.",
  repository_not_found: "This repository is no longer in RustGit's list.",
  authentication_failed:
    "Git's credential helper had no accepted credentials for this remote. RustGit never stores secrets. Git Credential Manager may open its own sign-in window on the first push or fetch; complete it and try again. Otherwise RustGit asks for the username, password or key passphrase itself; if you cancelled that prompt, retry and answer it.",
  operation_in_progress:
    "Git is in the middle of a merge, rebase, cherry-pick or revert. Open Uncommitted changes to resolve its conflicts, then continue or abort it.",
  operation_cancelled: "Cancelled. Git left no partial changes.",
};

export function errorHint(kind: ErrorKind): string | undefined {
  return HINTS[kind];
}

interface ErrorNoticeProps {
  title: string;
  error: IpcError;
  actions?: ReactNode;
}

export function ErrorNotice({ title, error, actions }: ErrorNoticeProps) {
  const hint: string | undefined = HINTS[error.kind];
  const [copied, setCopied] = useState<boolean>(false);

  const copyError = () => {
    void navigator.clipboard?.writeText(error.message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      role="alert"
      className="rg-notice-anim flex gap-3.5 rounded-xl border border-danger/35 bg-danger/10 p-4 shadow-sm transition-all"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-danger/15 border border-danger/25 text-danger">
        <CircleAlert aria-hidden className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-fg text-sm">{title}</p>
          <button
            type="button"
            onClick={copyError}
            title={copied ? "Copied error message" : "Copy error message"}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-hover hover:text-fg transition-colors"
          >
            {copied ? <Check aria-hidden className="size-3 text-success" /> : <Copy aria-hidden className="size-3" />}
            <span>{copied ? "copied" : "copy"}</span>
          </button>
        </div>
        <div className="rounded-lg border border-danger/20 bg-canvas/60 p-2.5">
          <p data-selectable className="max-h-48 overflow-y-auto break-words whitespace-pre-wrap font-mono text-xs text-fg-secondary leading-relaxed">
            {error.message}
          </p>
        </div>
        {hint !== undefined && <p className="text-xs text-fg-muted font-sans leading-relaxed">{hint}</p>}
        {actions !== undefined && <div className="flex items-center gap-2 pt-1">{actions}</div>}
      </div>
    </div>
  );
}
