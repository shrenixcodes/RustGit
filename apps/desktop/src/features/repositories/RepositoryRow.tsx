import { FolderGit2, Pin, PinOff, X } from "lucide-react";
import type { RepositoryEntry } from "../../services/types";

interface RepositoryRowProps {
  entry: RepositoryEntry;
  active: boolean;
  onOpen: (entry: RepositoryEntry) => void;
  onRemove: (entry: RepositoryEntry) => void;
  onTogglePin: (entry: RepositoryEntry) => void;
}

export function RepositoryRow({ entry, active, onOpen, onRemove, onTogglePin }: RepositoryRowProps) {
  return (
    <li
      className={`group flex items-center gap-3 px-3.5 py-2.5 transition-colors ${
        active ? "bg-selection text-fg" : "hover:bg-hover text-fg-secondary hover:text-fg"
      }`}
    >
      <FolderGit2 aria-hidden className={`size-4 shrink-0 ${active ? "text-accent" : "text-fg-muted"}`} />
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
        aria-label={`Open ${entry.name}`}
      >
        <span className="flex items-center gap-2 font-medium text-xs">
          <span className="truncate font-semibold text-fg">{entry.name}</span>
          {entry.pinned && <Pin aria-label="Pinned" className="size-3 text-accent" />}
          {active && (
            <span className="rounded-full bg-accent/15 border border-accent/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-accent">
              current
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-2xs text-fg-muted/80">{entry.path}</span>
      </button>
      <button
        type="button"
        onClick={() => onTogglePin(entry)}
        aria-label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
        title={entry.pinned ? "Unpin" : "Pin to top"}
        className={`rounded-md p-1.5 transition-all hover:bg-hover active:scale-95 ${
          entry.pinned ? "text-accent" : "text-fg-muted opacity-0 group-hover:opacity-100 hover:text-fg"
        }`}
      >
        {entry.pinned ? <PinOff aria-hidden className="size-3.5" /> : <Pin aria-hidden className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry)}
        aria-label={`Remove ${entry.name} from RustGit`}
        title="Remove from list (files are kept)"
        className="rounded-md p-1.5 text-fg-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger active:scale-95 group-hover:opacity-100"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}
