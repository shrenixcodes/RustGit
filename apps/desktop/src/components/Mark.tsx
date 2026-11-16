/**
 * RustGit mark: a single line that forks and rejoins (one branch, merged),
 * with the open node at its head, the same geometry the graph uses for
 * HEAD. Purely presentational; always rendered with a text equivalent nearby
 * or `aria-hidden`.
 */
export function Mark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      className={className}
    >
      {/* Trunk */}
      <path d="M9 21.5 V8.6" stroke="var(--rg-accent)" strokeWidth={1.6} />
      {/* Branch: leaves the trunk, rests at a commit, returns */}
      <path d="M9 18 C9 14.5 16 15.5 16 12.2" stroke="var(--rg-moss)" strokeWidth={1.4} />
      <path d="M16 12.2 C16 9.6 10.4 10.6 9 8.6" stroke="var(--rg-moss)" strokeWidth={1.4} />
      <circle cx={16} cy={12.2} r={1.5} fill="var(--rg-moss)" />
      {/* Open node: a ring left unfinished at the top */}
      <OpenNode cx={9} cy={5.4} r={2.6} stroke="var(--rg-clay)" width={1.6} />
    </svg>
  );
}

/** A ring with a gap at the top (between -120° and -60°). Used for HEAD. */
export function OpenNode({
  cx,
  cy,
  r,
  stroke,
  width,
}: {
  cx: number;
  cy: number;
  r: number;
  stroke: string;
  width: number;
}) {
  const start: number = (-60 * Math.PI) / 180;
  const end: number = (-120 * Math.PI) / 180 + 2 * Math.PI;
  const x1: number = cx + r * Math.cos(start);
  const y1: number = cy + r * Math.sin(start);
  const x2: number = cx + r * Math.cos(end);
  const y2: number = cy + r * Math.sin(end);
  return (
    <path
      d={`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      fill="none"
    />
  );
}
