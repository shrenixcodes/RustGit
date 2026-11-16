import type { NetworkOperation } from "../stores/operations";

/**
 * A hairline that fills with Git's own counts. Without counts it stays an
 * unfilled line: the phase text says what is happening, nothing is invented.
 */
export function ProgressLine({ operation, className = "" }: { operation: NetworkOperation; className?: string }) {
  const progress = operation.progress;
  const fraction: number | null = progress !== null && progress.total > 0 ? Math.min(1, progress.current / progress.total) : null;
  return (
    <div
      role="progressbar"
      aria-label={operation.label}
      aria-valuemin={fraction === null ? undefined : 0}
      aria-valuemax={fraction === null ? undefined : progress?.total}
      aria-valuenow={fraction === null ? undefined : progress?.current}
      aria-valuetext={operation.phase ?? "starting"}
      className={`h-px w-full bg-border ${className}`}
    >
      {fraction !== null && <div className="h-px bg-accent" style={{ width: `${fraction * 100}%` }} />}
    </div>
  );
}
