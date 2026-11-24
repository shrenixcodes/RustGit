import { memo } from "react";
import type { GraphRow, LaneLine } from "./graphLayout";

/** Padding on each side of the graph column so outer nodes and selection rings never clip. */
export const GRAPH_PAD_X = 6;

/** Lanes beyond this are clipped; the column never grows wider. */
export const MAX_DRAWN_LANES = 16;

/** Lane spacing per zoom step (-1 dense, 0 normal, 1 spacious). */
export function laneWidthFor(zoom: -1 | 0 | 1): number {
  return zoom === -1 ? 12 : zoom === 1 ? 20 : 16;
}

/** X coordinate of a lane's centerline inside the graph column. */
export function laneCenterX(lane: number, laneWidth: number): number {
  return GRAPH_PAD_X + lane * laneWidth + laneWidth / 2;
}

/** Total width of the graph SVG for `lanes` visible columns. */
export function graphCanvasWidth(lanes: number, laneWidth: number): number {
  return lanes * laneWidth + GRAPH_PAD_X * 2;
}

const PASSING_STROKE = 1.4;
const ACTIVE_STROKE = 1.75;

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

function smoothEdge(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dy: number = y2 - y1;
  // Vertical tangents at both endpoints keep adjacent straight segments C1-continuous.
  const c1y: number = y1 + dy * 0.48;
  const c2y: number = y2 - dy * 0.48;
  return `M ${x1} ${y1} C ${x1} ${c1y} ${x2} ${c2y} ${x2} ${y2}`;
}

/**
 * One row of the lineage. Lines come from the lane layout: lanes passing
 * through, edges from children above, edges to parents below. Node shapes
 * carry meaning: a clean disc is a commit, a ringed diamond a merge (outer ring
 * in the commit's lane color, inner diamond in the merged branch's color),
 * an anchored ring a root commit, and a double-ringed clay beacon HEAD.
 */
export const GraphCell = memo(function GraphCell({ row, width, height, laneWidth, head, selected, uncommitted }: GraphCellProps) {
  const x = (lane: number): number => laneCenterX(lane, laneWidth);
  const mid: number = height / 2;
  const nodeX: number = x(row.lane);
  const visible = (line: LaneLine): boolean => line.lane < MAX_DRAWN_LANES;
  const scale: number = laneWidth / 16;
  const passingStroke: number = PASSING_STROKE * scale;
  const activeStroke: number = ACTIVE_STROKE * scale;

  return (
    <svg data-graph-cell aria-hidden width={width} height={height} className="shrink-0 overflow-visible" style={{ display: "block" }}>
      {/* Dashed link connecting the loose end down to HEAD, behind commit nodes. */}
      {uncommitted !== undefined && uncommitted.lane < MAX_DRAWN_LANES && (
        <line
          x1={x(uncommitted.lane)}
          y1={0}
          x2={x(uncommitted.lane)}
          y2={uncommitted.span === "full" ? height : mid}
          stroke="var(--rg-accent)"
          strokeWidth={1.5 * scale}
          strokeDasharray="3 3"
          strokeLinecap="butt"
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
          strokeWidth={passingStroke}
          strokeOpacity={0.48}
          strokeLinecap="butt"
        />
      ))}
      {row.incoming.filter(visible).map((line: LaneLine) => (
        <path
          key={`i${line.lane}`}
          d={smoothEdge(x(line.lane), 0, nodeX, mid)}
          fill="none"
          stroke={laneColor(line.color)}
          strokeWidth={activeStroke}
          strokeOpacity={0.95}
          strokeLinecap="butt"
        />
      ))}
      {row.outgoing.filter(visible).map((line: LaneLine) => (
        <path
          key={`o${line.lane}`}
          d={smoothEdge(nodeX, mid, x(line.lane), height)}
          fill="none"
          stroke={laneColor(line.color)}
          strokeWidth={activeStroke}
          strokeOpacity={0.95}
          strokeLinecap="butt"
        />
      ))}
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
      {selected && (
        <circle cx={cx} cy={cy} r={8 * scale} fill="none" stroke="var(--rg-accent)" strokeOpacity={0.75} strokeWidth={1.5 * scale} />
      )}
      {head ? (
        // HEAD: a double-ringed clay beacon, visually anchored to the open node at the loose end.
        <>
          <circle cx={cx} cy={cy} r={6.8 * scale} fill={halo} />
          <circle cx={cx} cy={cy} r={5.1 * scale} fill={halo} stroke="var(--rg-clay)" strokeWidth={1.6 * scale} />
          <circle cx={cx} cy={cy} r={2.3 * scale} fill="var(--rg-clay)" />
        </>
      ) : row.merge ? (
        // Merge: outer ring in this branch's lane color, inner diamond in the merged branch's color.
        <>
          <circle cx={cx} cy={cy} r={6.2 * scale} fill={halo} />
          <circle cx={cx} cy={cy} r={4.5 * scale} fill={halo} stroke={color} strokeWidth={1.65 * scale} />
          <rect
            x={cx - 1.55 * scale}
            y={cy - 1.55 * scale}
            width={3.1 * scale}
            height={3.1 * scale}
            rx={0.5 * scale}
            transform={`rotate(45 ${cx} ${cy})`}
            fill={laneColor(row.outgoing[1]?.color ?? row.color)}
          />
        </>
      ) : row.root ? (
        // Root: hollow ring above a grounded anchor bar.
        <>
          <circle cx={cx} cy={cy} r={5 * scale} fill={halo} />
          <circle cx={cx} cy={cy} r={3.5 * scale} fill={halo} stroke={color} strokeWidth={1.7 * scale} />
          <line
            x1={cx - 4.5 * scale}
            y1={cy + 5.2 * scale}
            x2={cx + 4.5 * scale}
            y2={cy + 5.2 * scale}
            stroke={color}
            strokeWidth={1.6 * scale}
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <circle cx={cx} cy={cy} r={5 * scale} fill={halo} />
          <circle cx={cx} cy={cy} r={3.6 * scale} fill={color} />
        </>
      )}
    </g>
  );
}
