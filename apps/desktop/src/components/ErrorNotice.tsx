import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import type { IpcError } from "../services/ipc";
import type { ErrorKind } from "../services/types";

const HINTS: Partial<Record<ErrorKind, string>> = {
  git_not_found: "Install Git and make sure it is on your PATH, then restart RustGit.",
  not_a_repository: "The folder no longer contains a Git repository. It may have been moved or deleted.",
  invalid_path: "The folder does not exist or is not accessible.",
  repository_not_found: "This repository is no longer in RustGit's list.",
  authentication_failed:
    "Git's credential helper had no accepted credentials for this remote. RustGit never stores secrets. Git Credential Manager may open its own sign-in window on the first push or fetch; complete it and try again. Otherwise RustGit asks for the username, password or key passphrase itself; if you cancelled that prompt, retry and answer it.",
  operation_in_progress: "Another operation holds this repository. Try again when it finishes.",
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
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3.5 shadow-2xs transition-all"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-semibold text-fg text-sm">{title}</p>
        <p data-selectable className="max-h-48 overflow-y-auto break-words whitespace-pre-wrap font-mono text-xs text-fg-secondary/90 leading-relaxed">
          {error.message}
        </p>
        {hint !== undefined && <p className="text-xs text-fg-muted">{hint}</p>}
        {actions !== undefined && <div className="flex items-center gap-2 pt-1">{actions}</div>}
      </div>
    </div>
  );
}
