import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import type { IpcError } from "../services/ipc";
import type { ErrorKind } from "../services/types";

const HINTS: Partial<Record<ErrorKind, string>> = {
  git_not_found: "Install Git and make sure it is on your PATH, then restart RustGit.",
  not_a_repository: "The folder no longer contains a Git repository. It may have been moved or deleted.",
  invalid_path: "The folder does not exist or is not accessible.",
  repository_not_found: "This repository is no longer in RustGit's list.",
};

interface ErrorNoticeProps {
  title: string;
  error: IpcError;
  actions?: ReactNode;
}

export function ErrorNotice({ title, error, actions }: ErrorNoticeProps) {
  const hint: string | undefined = HINTS[error.kind];
  return (
    <div role="alert" className="flex gap-2.5 rounded-md border border-border bg-surface p-3">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-fg">{title}</p>
        <p data-selectable className="break-words text-sm text-fg-secondary">
          {error.message}
        </p>
        {hint !== undefined && <p className="text-sm text-fg-muted">{hint}</p>}
        {actions !== undefined && <div className="flex gap-2 pt-1">{actions}</div>}
      </div>
    </div>
  );
}
