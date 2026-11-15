import { Pin, PinOff, X } from "lucide-react";
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
    <li className={`group flex items-center gap-2 px-3 py-2 ${active ? "bg-selection" : "hover:bg-hover"}`}>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="min-w-0 flex-1 rounded-sm text-left"
        aria-label={`Open ${entry.name}`}
      >
        <span className="flex items-center gap-1.5 font-medium">
          {entry.pinned && <Pin aria-label="Pinned" className="size-3 text-accent" />}
          <span className="truncate">{entry.name}</span>
        </span>
        <span className="block truncate font-mono text-xs text-fg-muted">{entry.path}</span>
      </button>
      <button
        type="button"
        onClick={() => onTogglePin(entry)}
        aria-label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
        title={entry.pinned ? "Unpin" : "Pin to top"}
        className="rounded-sm p-1 text-fg-muted hover:bg-hover hover:text-fg"
      >
        {entry.pinned ? <PinOff aria-hidden className="size-3.5" /> : <Pin aria-hidden className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry)}
        aria-label={`Remove ${entry.name} from RustGit`}
        title="Remove from list (files are kept)"
        className="rounded-sm p-1 text-fg-muted hover:bg-hover hover:text-danger"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}
