import { useEffect, useId, useRef, type ReactNode } from "react";
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
    const element: HTMLDialogElement | null = dialog.current;
    if (element === null) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    cancel.current?.focus();
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
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
      className="m-auto w-[440px] max-w-[calc(100vw-32px)] rounded-md border border-border bg-elevated p-0 text-fg shadow-popover backdrop:bg-overlay"
    >
      <div className="space-y-3 px-6 pt-5 pb-4">
        <h2 id={titleId} className="text-base font-medium">
          {title}
        </h2>
        <div className="space-y-2 text-sm text-fg-secondary">{children}</div>
      </div>
      <div className="flex justify-end gap-2 px-6 pb-5">
        <Button ref={cancel} onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
