import { memo } from "react";
import type { GraphRow, LaneLine } from "./graphLayout";

/** Lanes beyond this are clipped; the column never grows wider. */
export const MAX_DRAWN_LANES = 16;

/** Lane spacing per zoom step (-1 dense, 0 normal, 1 spacious). */
export function laneWidthFor(zoom: -1 | 0 | 1): number {
  return zoom === -1 ? 12 : zoom === 1 ? 20 : 16;
}

const STROKE = 1.25;

function laneColor(color: number): string {
  return `var(--rg-lane-${color})`;
}

interface GraphCellProps {
  row: GraphRow;
  width: number;
  height: number;
  laneWidth: number;
  head: boolean;
  selected: boolean;
  /**
   * Lane of the uncommitted link from the loose end down to HEAD: "full"
   * on rows between them, "top" on the HEAD row itself.
   */
  uncommitted?: { lane: number; span: "full" | "top" } | undefined;
}

/**
 * One row of the lineage. Lines come from the lane layout: lanes passing
 * through, edges from children above, edges to parents below. Node shapes
 * carry meaning: a point is a commit, paired points a merge (one per side,
 * each in its parent's lane colour), a short bar a root, a clay point HEAD.
 */
export const GraphCell = memo(function GraphCell({ row, width, height, laneWidth, head, selected, uncommitted }: GraphCellProps) {
  const x = (lane: number): number => laneWidth / 2 + lane * laneWidth;
  const mid: number = height / 2;
  const nodeX: number = x(row.lane);
  const visible = (line: LaneLine): boolean => line.lane < MAX_DRAWN_LANES;
  const scale: number = laneWidth / 16;

  return (
    <svg data-graph-cell aria-hidden width={width} height={height} className="shrink-0 overflow-visible" style={{ display: "block" }}>
      {uncommitted !== undefined && uncommitted.lane < MAX_DRAWN_LANES && (
        <line
          x1={x(uncommitted.lane)}
          y1={0}
          x2={x(uncommitted.lane)}
          y2={uncommitted.span === "full" ? height : mid}
          stroke="var(--rg-accent)"
          strokeWidth={STROKE}
          strokeDasharray="2 3"
        />
      )}
      {row.passing.filter(visible).map((line: LaneLine) => (
        <line
          key={`p${line.lane}`}
          x1={x(line.lane)}
          y1={0}
          x2={x(line.lane)}
          y2={height}
          stroke={laneColor(line.color)}
          strokeWidth={STROKE}
          strokeOpacity={0.55}
        />
      ))}
      {row.incoming.filter(visible).map((line: LaneLine) => {
        const from: number = x(line.lane);
        const d: string =
          from === nodeX
            ? `M ${from} 0 L ${nodeX} ${mid}`
            : `M ${from} 0 C ${from} ${mid * 0.7} ${nodeX} ${mid * 0.3} ${nodeX} ${mid}`;
        return <path key={`i${line.lane}`} d={d} fill="none" stroke={laneColor(line.color)} strokeWidth={STROKE} />;
      })}
      {row.outgoing.filter(visible).map((line: LaneLine) => {
        const to: number = x(line.lane);
        const d: string =
          to === nodeX
            ? `M ${nodeX} ${mid} L ${to} ${height}`
            : `M ${nodeX} ${mid} C ${nodeX} ${mid + (height - mid) * 0.7} ${to} ${mid + (height - mid) * 0.3} ${to} ${height}`;
        return <path key={`o${line.lane}`} d={d} fill="none" stroke={laneColor(line.color)} strokeWidth={STROKE} />;
      })}
      {row.lane < MAX_DRAWN_LANES && (
        <Node x={nodeX} y={mid} row={row} head={head} selected={selected} scale={scale} />
      )}
    </svg>
  );
});

function Node({
  x: cx,
  y: cy,
  row,
  head,
  selected,
  scale,
}: {
  x: number;
  y: number;
  row: GraphRow;
  head: boolean;
  selected: boolean;
  scale: number;
}) {
  const color: string = laneColor(row.color);
  const halo = "var(--rg-canvas)";
  return (
    <g>
      {selected && <circle cx={cx} cy={cy} r={7.5 * scale} fill="none" stroke="var(--rg-accent)" strokeOpacity={0.55} strokeWidth={1} />}
      {head ? (
        // HEAD: the present commit, a solid clay point. The open node belongs to the loose end above it.
        <circle cx={cx} cy={cy} r={4 * scale} fill="var(--rg-clay)" stroke={halo} strokeWidth={1.5} />
      ) : row.merge ? (
        <>
          <circle cx={cx - 2.4 * scale} cy={cy} r={2.9 * scale} fill={color} stroke={halo} strokeWidth={1.25} />
          <circle
            cx={cx + 2.4 * scale}
            cy={cy}
            r={2.9 * scale}
            fill={laneColor(row.outgoing[1]?.color ?? row.color)}
            stroke={halo}
            strokeWidth={1.25}
          />
        </>
      ) : row.root ? (
        <rect x={cx - 4.5 * scale} y={cy - 1.25} width={9 * scale} height={2.5} rx={1} fill={color} />
      ) : (
        <circle cx={cx} cy={cy} r={3.2 * scale} fill={color} stroke={halo} strokeWidth={1.5} />
      )}
    </g>
  );
}
