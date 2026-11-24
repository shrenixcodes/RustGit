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
      className={`h-1 w-full overflow-hidden rounded-full bg-border ${className}`}
    >
      {fraction === null ? (
        <div className="rg-progress-indeterminate h-full w-2/5 rounded-full bg-accent/80" />
      ) : (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-[var(--rg-ease-out)]"
          style={{ width: `${fraction * 100}%` }}
        />
      )}
    </div>
  );
}
