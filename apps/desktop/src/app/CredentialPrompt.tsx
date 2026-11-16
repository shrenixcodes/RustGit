import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "../components/Button";
import { ipc } from "../services/ipc";
import type { CredentialRequest } from "../services/types";

/** Pieces of Git's prompt text worth showing: the prompt without its trailing ": ". */
export function promptLabel(prompt: string): string {
  return prompt.replace(/[:\s]+$/, "");
}

/**
 * Answers password, username and key passphrase prompts raised by Git and
 * ssh. The answer goes straight back to the waiting process and is never
 * stored or logged. Prompts queue; closing the dialog declines the prompt,
 * which makes Git fail with an authentication error.
 */
export function CredentialPrompt() {
  const [queue, setQueue] = useState<CredentialRequest[]>([]);

  useEffect(() => {
    let disposed = false;
    let stop: UnlistenFn | null = null;
    void listen<CredentialRequest>("credential-requested", (event) => {
      setQueue((current) => [...current, event.payload]);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const current: CredentialRequest | undefined = queue[0];
  if (current === undefined) return null;
  const answer = (value: string | null): void => {
    void ipc.respondCredential(current.requestId, value).catch(() => {});
    setQueue((rest) => rest.slice(1));
  };
  return <CredentialDialog key={current.requestId} request={current} onAnswer={answer} />;
}

function CredentialDialog({ request, onAnswer }: { request: CredentialRequest; onAnswer: (value: string | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<string>("");
  const titleId: string = useId();

  useEffect(() => {
    const element: HTMLDialogElement | null = dialog.current;
    if (element === null) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    input.current?.focus();
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onAnswer(value);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onAnswer(null);
      }}
      className="m-auto w-[440px] max-w-[calc(100vw-32px)] rounded-md border border-border bg-elevated p-0 text-fg shadow-popover backdrop:bg-overlay"
    >
      <form onSubmit={submit}>
        <div className="space-y-3 px-6 pt-5 pb-4">
          <h2 id={titleId} className="text-base font-medium">
            Git needs a credential
          </h2>
          <label className="block space-y-1.5 text-sm text-fg-secondary">
            <span data-selectable className="block break-words font-mono text-xs">
              {promptLabel(request.prompt)}
            </span>
            <input
              ref={input}
              type={request.secret ? "password" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full border-b border-border bg-transparent font-mono text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <p className="text-xs text-fg-muted">RustGit passes this straight to Git. It is not stored or logged.</p>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5">
          <Button onClick={() => onAnswer(null)}>Cancel</Button>
          <Button type="submit" variant="primary">
            Continue
          </Button>
        </div>
      </form>
    </dialog>
  );
}
