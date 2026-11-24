import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GraphCell, GRAPH_PAD_X, graphCanvasWidth, laneCenterX } from "./GraphCell";
import type { GraphRow } from "./graphLayout";

function sampleRow(overrides: Partial<GraphRow> = {}): GraphRow {
  return {
    oid: "aaaa",
    lane: 0,
    color: 0,
    merge: false,
    root: false,
    incoming: [{ lane: 0, color: 0 }],
    outgoing: [{ lane: 0, color: 0 }],
    passing: [],
    width: 1,
    ...overrides,
  };
}

describe("GraphCell geometry", () => {
  it("centers lanes inside the graph padding", () => {
    expect(laneCenterX(0, 16)).toBe(GRAPH_PAD_X + 8);
    expect(laneCenterX(2, 16)).toBe(GRAPH_PAD_X + 40);
    expect(graphCanvasWidth(3, 16)).toBe(3 * 16 + GRAPH_PAD_X * 2);
  });

  it("renders monotonic cubic Bezier curves with non-inverted control points", () => {
    const row = sampleRow({
      lane: 0,
      incoming: [{ lane: 2, color: 2 }],
      outgoing: [
        { lane: 0, color: 0 },
        { lane: 1, color: 1 },
      ],
      width: 3,
    });
    const { container } = render(
      <GraphCell row={row} width={graphCanvasWidth(3, 16)} height={32} laneWidth={16} head={false} selected={false} />,
    );
    const paths = [...container.querySelectorAll("path")];
    const curved = paths.map((el) => el.getAttribute("d") ?? "").filter((d) => d.includes(" C "));
    expect(curved).toHaveLength(2);
    for (const d of curved) {
      const match = /M [\d.]+ ([\d.]+) C [\d.]+ ([\d.]+) [\d.]+ ([\d.]+) [\d.]+ ([\d.]+)/.exec(d);
      expect(match).not.toBeNull();
      const [, y1, c1y, c2y, y2] = match!.map(Number);
      expect(c1y).toBeGreaterThanOrEqual(y1!);
      expect(c2y).toBeGreaterThanOrEqual(c1y!);
      expect(y2!).toBeGreaterThanOrEqual(c2y!);
    }
  });

  it("draws distinct merge diamond, root anchor cap, and HEAD rings", () => {
    const mergeRender = render(
      <GraphCell row={sampleRow({ merge: true, outgoing: [{ lane: 0, color: 0 }, { lane: 1, color: 3 }] })} width={44} height={32} laneWidth={16} head={false} selected={false} />,
    );
    expect(mergeRender.container.querySelector("rect[transform*='rotate(45']")).not.toBeNull();

    const rootRender = render(
      <GraphCell row={sampleRow({ root: true, outgoing: [] })} width={44} height={32} laneWidth={16} head={false} selected={false} />,
    );
    expect(rootRender.container.querySelectorAll("circle")).toHaveLength(2);
    expect(rootRender.container.querySelectorAll("path")).toHaveLength(1);
    const lines = rootRender.container.querySelectorAll("line");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.getAttribute("y1")).toBe(lines[0]?.getAttribute("y2"));

    const headRender = render(
      <GraphCell row={sampleRow()} width={44} height={32} laneWidth={16} head={true} selected={true} />,
    );
    expect(headRender.container.querySelectorAll("circle")).toHaveLength(4); // selection ring + halo + outer ring + inner core
  });
});
