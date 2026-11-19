import { useState } from "react";
import { Check, Copy, FolderGit2, Pin, PinOff, X } from "lucide-react";
import type { RepositoryEntry } from "../../services/types";
import { formatRelative } from "../history/time";

interface RepositoryRowProps {
  entry: RepositoryEntry;
  active: boolean;
  onOpen: (entry: RepositoryEntry) => void;
  onRemove: (entry: RepositoryEntry) => void;
  onTogglePin: (entry: RepositoryEntry) => void;
}

export function RepositoryRow({ entry, active, onOpen, onRemove, onTogglePin }: RepositoryRowProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const copyPath = (path: string) => {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <li
      className={`group relative flex items-center gap-3 px-4 py-3 transition-all ${
        active
          ? "bg-selection text-fg border-l-2 border-l-accent"
          : "hover:bg-hover/70 text-fg-secondary hover:text-fg border-l-2 border-l-transparent"
      }`}
    >
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
          active
            ? "border-accent/40 bg-accent/15 text-accent shadow-xs"
            : "border-border/80 bg-elevated/70 text-fg-muted group-hover:border-border-control group-hover:text-fg"
        }`}
      >
        <FolderGit2 aria-hidden className="size-4" />
      </div>

      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
        aria-label={`Open ${entry.name}`}
      >
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-sm text-fg tracking-tight">{entry.name}</span>
          {entry.pinned && <Pin aria-label="Pinned" className="size-3 text-accent shrink-0 fill-accent/20" />}
          {active && (
            <span className="rounded-full bg-accent/15 border border-accent/25 px-2 py-0.5 font-mono text-2xs font-semibold text-accent">
              current
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="truncate font-mono text-xs text-fg-muted/80">{entry.path}</span>
          {entry.lastOpenedAt !== null && (
            <span className="hidden sm:inline font-mono text-2xs text-fg-muted/60 shrink-0">
              · opened {formatRelative(entry.lastOpenedAt)}
            </span>
          )}
        </div>
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => copyPath(entry.path)}
          aria-label={copied ? "Copied path" : "Copy path"}
          title={copied ? "Copied path" : "Copy path"}
          className="rounded-md p-1.5 text-fg-muted opacity-0 transition-all hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 active:scale-95"
        >
          {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onTogglePin(entry)}
          aria-label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
          title={entry.pinned ? "Unpin" : "Pin to top"}
          className={`rounded-md p-1.5 transition-all hover:bg-hover active:scale-95 ${
            entry.pinned ? "text-accent" : "text-fg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg"
          }`}
        >
          {entry.pinned ? <PinOff aria-hidden className="size-3.5" /> : <Pin aria-hidden className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onRemove(entry)}
          aria-label={`Remove ${entry.name} from RustGit`}
          title="Remove from list (files are kept)"
          className="rounded-md p-1.5 text-fg-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger active:scale-95 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
