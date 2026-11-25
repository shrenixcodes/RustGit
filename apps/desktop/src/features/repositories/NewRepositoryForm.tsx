import { useState, type FormEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileCode, FileText, Scale } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { toIpcError, type IpcError } from "../../services/ipc";
import { useInitRepository } from "../../services/queries";
import type { RepositoryEntry } from "../../services/types";
import { useWorkspace } from "../../stores/workspace";

const GITIGNORE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "node", label: "Node.js / TypeScript" },
  { value: "rust", label: "Rust" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "cpp", label: "C / C++" },
  { value: "java", label: "Java" },
  { value: "general", label: "General (OS & Editor)" },
] as const;

const LICENSE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "mit", label: "MIT License" },
  { value: "apache-2.0", label: "Apache License 2.0" },
  { value: "gpl-3.0", label: "GNU General Public License v3.0" },
  { value: "bsd-3-clause", label: "BSD 3-Clause License" },
  { value: "unlicense", label: "The Unlicense" },
] as const;

/** Why a folder name cannot be used, or null when it is fine. */
export function folderNameProblem(name: string): string | null {
  const trimmed: string = name.trim();
  if (trimmed === "") return null;
  if (trimmed === "." || trimmed === "..") return "Use a real folder name.";
  if (/[\\/:*?"<>|\0]/.test(trimmed)) return 'The name cannot contain any of \\ / : * ? " < > |';
  if (/[. ]$/.test(trimmed)) return "The name cannot end with a dot or a space.";
  return null;
}

/** The path of the new repository: the parent folder plus the name, using the parent's separator. */
export function newRepositoryPath(parent: string, name: string): string {
  const separator: string = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[/\\]+$/, "")}${separator}${name.trim()}`;
}

/**
 * Create a repository: name, description, location, and optional starter files
 * (README, .gitignore, LICENSE).
 */
export function NewRepositoryForm({ onDone }: { onDone: () => void }) {
  const initRepository = useInitRepository();
  const activate = useWorkspace((state) => state.openRepository);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [parent, setParent] = useState<string>("");
  const [readme, setReadme] = useState<boolean>(true);
  const [gitignore, setGitignore] = useState<string>("none");
  const [license, setLicense] = useState<string>("none");
  const [error, setError] = useState<IpcError | null>(null);

  const problem: string | null = folderNameProblem(name);
  const ready: boolean = name.trim() !== "" && parent.trim() !== "" && problem === null;

  const pickParent = async (): Promise<void> => {
    const selected: string | string[] | null = await openDialog({
      directory: true,
      multiple: false,
      title: "Folder for the new repository",
    });
    if (typeof selected === "string") setParent(selected);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      const created: RepositoryEntry = await initRepository.mutateAsync({
        path: newRepositoryPath(parent.trim(), name),
        description: description.trim() || undefined,
        readme,
        gitignore: gitignore !== "none" ? gitignore : undefined,
        license: license !== "none" ? license : undefined,
      });
      activate(created.id, created.path);
      onDone();
    } catch (failure: unknown) {
      setError(toIpcError(failure));
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label="Create a repository"
      className="space-y-3.5 rounded-xl border border-border/80 bg-elevated/80 p-4 shadow-sm"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="rg-label">Repository Name</span>
          <input
            autoFocus
            required
            value={name}
            disabled={initRepository.isPending}
            onChange={(event) => setName(event.target.value)}
            placeholder="my-project"
            aria-invalid={problem !== null}
            className="mt-1 flex h-9 w-full rounded-md border border-border/70 bg-canvas/60 px-3 font-mono text-xs outline-none transition-all placeholder:text-fg-muted focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30"
          />
          {problem !== null && <span className="mt-1 block text-xs text-danger">{problem}</span>}
        </label>

        <label className="block">
          <span className="rg-label">Description (optional)</span>
          <input
            value={description}
            disabled={initRepository.isPending}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A short summary of the repository"
            className="mt-1 flex h-9 w-full rounded-md border border-border/70 bg-canvas/60 px-3 font-sans text-xs outline-none transition-all placeholder:text-fg-muted focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30"
          />
        </label>
      </div>

      <div className="flex items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="rg-label">Location Folder</span>
          <input
            required
            value={parent}
            disabled={initRepository.isPending}
            onChange={(event) => setParent(event.target.value)}
            placeholder="Choose parent folder on disk"
            className="mt-1 flex h-9 w-full rounded-md border border-border/70 bg-canvas/60 px-3 font-mono text-xs outline-none transition-all placeholder:text-fg-muted focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30"
          />
        </label>
        <Button disabled={initRepository.isPending} onClick={() => void pickParent()}>
          Browse…
        </Button>
      </div>

      {/* Starter files: README, .gitignore, LICENSE */}
      <div className="rounded-lg border border-border/60 bg-canvas/40 p-3 space-y-3">
        <span className="block font-sans text-xs font-semibold text-fg">Starter Configuration</span>

        <label className="flex items-center gap-2 cursor-pointer text-xs text-fg">
          <input
            type="checkbox"
            checked={readme}
            disabled={initRepository.isPending}
            onChange={(e) => setReadme(e.target.checked)}
            className="size-4 rounded border-border/70 bg-canvas text-accent focus:ring-accent/30"
          />
          <FileText className="size-3.5 text-accent" />
          <span>Initialize repository with a README.md</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <label className="block">
            <span className="flex items-center gap-1.5 rg-label">
              <FileCode className="size-3 text-clay-text" />
              <span>.gitignore template</span>
            </span>
            <select
              value={gitignore}
              disabled={initRepository.isPending}
              onChange={(e) => setGitignore(e.target.value)}
              className="mt-1 flex h-8 w-full rounded-md border border-border/70 bg-canvas px-2.5 font-sans text-xs text-fg outline-none focus:border-accent"
            >
              {GITIGNORE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="flex items-center gap-1.5 rg-label">
              <Scale className="size-3 text-success" />
              <span>License</span>
            </span>
            <select
              value={license}
              disabled={initRepository.isPending}
              onChange={(e) => setLicense(e.target.value)}
              className="mt-1 flex h-8 w-full rounded-md border border-border/70 bg-canvas px-2.5 font-sans text-xs text-fg outline-none focus:border-accent"
            >
              {LICENSE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {ready && (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs font-mono text-fg-muted">
          <span>Target: {newRepositoryPath(parent.trim(), name)}</span>
          <span className="text-fg-muted/40">·</span>
          <span>Branch: main</span>
          {readme && <span className="rounded bg-accent/15 px-1 py-0.2 text-accent">README.md</span>}
          {gitignore !== "none" && <span className="rounded bg-clay/15 px-1 py-0.2 text-clay-text">.gitignore</span>}
          {license !== "none" && <span className="rounded bg-success/15 px-1 py-0.2 text-success">LICENSE</span>}
        </div>
      )}

      {error !== null && <ErrorNotice title="Could not create the repository" error={error} />}

      <div className="flex gap-2 pt-1">
        <Button type="submit" variant="primary" disabled={!ready || initRepository.isPending}>
          Create repository
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}
