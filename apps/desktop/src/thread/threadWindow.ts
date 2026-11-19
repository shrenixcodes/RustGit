import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The one unfolded region: it sits directly below row `after`. */
export interface Unfolding {
  after: number;
  height: number;
}

/** Top offset of row `index`, accounting for an unfolded region above it. */
export function rowTop(index: number, rowHeight: number, unfolding: Unfolding | null): number {
  return index * rowHeight + (unfolding !== null && index > unfolding.after ? unfolding.height : 0);
}

/** Rows to render for a scroll position, with overscan. */
export function computeThreadWindow(
  count: number,
  rowHeight: number,
  unfolding: Unfolding | null,
  scrollTop: number,
  viewport: number,
  overscan: number,
): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 };
  const rowAt = (offset: number): number => {
    if (unfolding === null) return Math.floor(offset / rowHeight);
    const regionStart: number = (unfolding.after + 1) * rowHeight;
    if (offset < regionStart) return Math.floor(offset / rowHeight);
    if (offset < regionStart + unfolding.height) return unfolding.after;
    return Math.floor((offset - unfolding.height) / rowHeight);
  };
  const first: number = rowAt(Math.max(0, scrollTop));
  const last: number = rowAt(Math.max(0, scrollTop) + viewport);
  const start: number = Math.max(0, Math.min(count - 1, first - overscan));
  const end: number = Math.min(count, last + 1 + overscan);
  return { start, end: Math.max(end, start + 1) };
}

/**
 * Windowed rendering for the thread: fixed-height rows plus at most one
 * unfolded region of known height. Only nearby rows are mounted.
 */
export function useThreadWindow(
  container: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  unfolding: Unfolding | null,
): {
  start: number;
  end: number;
  totalHeight: number;
  viewport: number;
  ensureVisible: (index: number, extra?: number) => void;
} {
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewport, setViewport] = useState<number>(800);

  const unfoldingRef = useRef(unfolding);
  unfoldingRef.current = unfolding;
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;

  useLayoutEffect(() => {
    const element: HTMLElement | null = container.current;
    if (element === null) return;
    const measure = (): void => setViewport(element.clientHeight > 0 ? element.clientHeight : 800);
    const onScroll = (): void => setScrollTop(element.scrollTop);
    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer: ResizeObserver | null = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [container]);

  const ensureVisible = useCallback(
    (index: number, extra: number = 0): void => {
      const element: HTMLElement | null = container.current;
      if (element === null) return;
      const top: number = rowTop(index, rowHeightRef.current, unfoldingRef.current);
      const bottom: number = top + rowHeightRef.current + extra;
      const height: number = element.clientHeight > 0 ? element.clientHeight : 800;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + height) element.scrollTop = Math.min(top, bottom - height);
    },
    [container],
  );

  const { start, end } = computeThreadWindow(count, rowHeight, unfolding, scrollTop, viewport, 10);
  return { start, end, totalHeight: count * rowHeight + (unfolding?.height ?? 0), viewport, ensureVisible };
}
