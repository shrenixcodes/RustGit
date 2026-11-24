import { createElement, useRef, type ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { computeWindow, useVirtualRows } from "./useVirtualRows";

describe("computeWindow", () => {
  it("renders only the visible rows plus overscan", () => {
    // 10 000 rows of 24 px, scrolled to row 500, 480 px viewport.
    const { start, end } = computeWindow(10_000, 24, 500 * 24, 480, 8);
    expect(start).toBe(492);
    expect(end).toBe(500 + 21 + 8);
    expect(end - start).toBeLessThan(40);
  });

  it("clamps at the edges", () => {
    expect(computeWindow(5, 24, 0, 480, 8)).toEqual({ start: 0, end: 5 });
    expect(computeWindow(100, 24, 99_999, 480, 2)).toEqual({ start: 99, end: 100 });
    expect(computeWindow(0, 24, 0, 480, 8)).toEqual({ start: 0, end: 0 });
  });
});

function Harness({ mounted }: { mounted: boolean }): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const { start } = useVirtualRows(container, 1_000, 20, 0);
  return createElement(
    "div",
    null,
    createElement("output", { "data-testid": "start" }, String(start)),
    mounted ? createElement("div", { ref: container, "data-testid": "list" }) : null,
  );
}

describe("useVirtualRows", () => {
  it("follows the scroll container after it is unmounted and recreated", () => {
    const { rerender } = render(createElement(Harness, { mounted: true }));
    rerender(createElement(Harness, { mounted: false }));
    rerender(createElement(Harness, { mounted: true }));
    const list: HTMLElement = screen.getByTestId("list");
    act(() => {
      list.scrollTop = 2_000;
      fireEvent.scroll(list);
    });
    expect(screen.getByTestId("start").textContent).toBe("100");
  });
});
