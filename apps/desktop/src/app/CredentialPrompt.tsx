import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
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
  const [reveal, setReveal] = useState<boolean>(false);
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
      className="m-auto w-[460px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-border/80 bg-elevated p-0 text-fg shadow-popover backdrop:bg-overlay"
      style={{ backgroundColor: "var(--rg-elevated)" }}
    >
      <form onSubmit={submit}>
        <div className="space-y-4 px-6 pt-6 pb-5">
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
              <KeyRound aria-hidden className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h2 id={titleId} className="text-base font-semibold text-fg">
                Git needs a credential
              </h2>
              <p className="text-xs text-fg-muted font-sans leading-relaxed">
                RustGit passes this straight to Git. It is never stored or logged.
              </p>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span data-selectable className="block break-words font-mono text-xs text-fg-secondary">
              {promptLabel(request.prompt)}
            </span>
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-canvas/80 px-3 shadow-2xs transition-all focus-within:border-accent focus-within:bg-canvas focus-within:ring-2 focus-within:ring-accent/35">
              <input
                ref={input}
                type={request.secret && !reveal ? "password" : "text"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm text-fg outline-none"
              />
              {request.secret && (
                <button
                  type="button"
                  onClick={() => setReveal((shown) => !shown)}
                  aria-label={reveal ? "Hide secret" : "Show secret"}
                  title={reveal ? "Hide secret" : "Show secret"}
                  className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg transition-colors"
                >
                  {reveal ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
                </button>
              )}
            </div>
          </label>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-divider/60 bg-surface/40 px-6 py-3.5">
          <Button onClick={() => onAnswer(null)} className="h-8 text-xs font-medium">
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="h-8 text-xs font-semibold px-4">
            Continue
          </Button>
        </div>
      </form>
    </dialog>
  );
}
