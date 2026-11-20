import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Button } from "./Button";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  /** Names the action, e.g. "Discard 3 lines". Never "OK". */
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation on the native <dialog> (focus trap and Escape come
 * from the platform). Cancel has the initial focus, so Enter never confirms
 * a destructive action by accident.
 */
export function ConfirmDialog({ title, children, confirmLabel, destructive = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId: string = useId();

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const element: HTMLDialogElement | null = dialog.current;
    if (element === null) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    cancel.current?.focus();
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
      previousFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[460px] max-w-[calc(100vw-32px)] rounded-2xl border border-border/80 bg-elevated p-0 text-fg shadow-popover backdrop:bg-overlay backdrop:backdrop-blur-sm"
      style={{ backgroundColor: "var(--rg-elevated)" }}
    >
      <div className="space-y-3.5 px-6 pt-6 pb-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${
              destructive
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-accent/30 bg-accent/10 text-accent"
            }`}
          >
            {destructive ? <AlertTriangle className="size-5" /> : <HelpCircle className="size-5" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            <div className="space-y-2 text-xs text-fg-secondary leading-relaxed font-sans">{children}</div>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2.5 border-t border-divider/60 bg-surface/40 px-6 py-3.5">
        <Button ref={cancel} onClick={onCancel} disabled={busy} className="h-8 text-xs font-medium">
          Cancel
        </Button>
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy} className="h-8 text-xs font-semibold px-4">
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
