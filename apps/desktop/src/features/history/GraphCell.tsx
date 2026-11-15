import { memo } from "react";
import type { GraphRow, LaneLine } from "./graphLayout";

export const LANE_WIDTH = 14;
/** Lanes beyond this are clipped; the column never grows wider. */
export const MAX_DRAWN_LANES = 16;

const STROKE = 1.5;

function x(lane: number): number {
  return LANE_WIDTH / 2 + lane * LANE_WIDTH;
}

function laneColor(color: number): string {
  return `var(--rg-lane-${color})`;
}

interface GraphCellProps {
  row: GraphRow;
  width: number;
  height: number;
  head: boolean;
  selected: boolean;
}

/**
 * One row of the commit graph. Lines come from the lane layout: lanes
 * passing through, edges from children above, edges to parents below.
 */
export const GraphCell = memo(function GraphCell({ row, width, height, head, selected }: GraphCellProps) {
  const mid: number = height / 2;
  const nodeX: number = x(row.lane);
  const visible = (line: LaneLine): boolean => line.lane < MAX_DRAWN_LANES;

  return (
    <svg data-graph-cell aria-hidden width={width} height={height} className="shrink-0 overflow-visible" style={{ display: "block" }}>
      {row.passing.filter(visible).map((line: LaneLine) => (
        <line
          key={`p${line.lane}`}
          x1={x(line.lane)}
          y1={0}
          x2={x(line.lane)}
          y2={height}
          stroke={laneColor(line.color)}
          strokeWidth={STROKE}
          strokeOpacity={0.7}
        />
      ))}
      {row.incoming.filter(visible).map((line: LaneLine) => {
        const from: number = x(line.lane);
        const d: string =
          from === nodeX
            ? `M ${from} 0 L ${nodeX} ${mid}`
            : `M ${from} 0 C ${from} ${mid * 0.6} ${nodeX} ${mid * 0.4} ${nodeX} ${mid}`;
        return <path key={`i${line.lane}`} d={d} fill="none" stroke={laneColor(line.color)} strokeWidth={STROKE} />;
      })}
      {row.outgoing.filter(visible).map((line: LaneLine) => {
        const to: number = x(line.lane);
        const d: string =
          to === nodeX
            ? `M ${nodeX} ${mid} L ${to} ${height}`
            : `M ${nodeX} ${mid} C ${nodeX} ${mid + (height - mid) * 0.6} ${to} ${mid + (height - mid) * 0.4} ${to} ${height}`;
        return <path key={`o${line.lane}`} d={d} fill="none" stroke={laneColor(line.color)} strokeWidth={STROKE} />;
      })}
      {row.lane < MAX_DRAWN_LANES && <Node x={nodeX} y={mid} row={row} head={head} selected={selected} />}
    </svg>
  );
});

function Node({ x: cx, y: cy, row, head, selected }: { x: number; y: number; row: GraphRow; head: boolean; selected: boolean }) {
  const color: string = laneColor(row.color);
  return (
    <g>
      {(selected || head) && (
        <circle cx={cx} cy={cy} r={7} fill={head ? "var(--rg-accent)" : color} fillOpacity={head ? 0.22 : 0.18} />
      )}
      {head ? (
        // HEAD: filled with the accent, ringed.
        <circle cx={cx} cy={cy} r={4.5} fill="var(--rg-accent)" stroke="var(--rg-canvas)" strokeWidth={1.5} />
      ) : row.merge ? (
        // Merge: hollow ring with a centre dot.
        <>
          <circle cx={cx} cy={cy} r={4.5} fill="var(--rg-canvas)" stroke={color} strokeWidth={STROKE} />
          <circle cx={cx} cy={cy} r={1.6} fill={color} />
        </>
      ) : (
        <circle cx={cx} cy={cy} r={3.5} fill="var(--rg-canvas)" stroke={color} strokeWidth={STROKE + 0.5} />
      )}
    </g>
  );
}
