import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/** Viewport height assumed before layout (and in environments without layout, such as tests). */
const FALLBACK_VIEWPORT = 800;

export interface VirtualWindow {
  /** First rendered row index (inclusive). */
  start: number;
  /** Last rendered row index (exclusive). */
  end: number;
  /** Height of the full list, for the spacer. */
  totalHeight: number;
  /** Scrolls the minimum distance needed to make `index` fully visible. */
  ensureVisible: (index: number) => void;
}

/** Pure window computation, exported for tests. */
export function computeWindow(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  if (count === 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const first: number = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible: number = Math.ceil(viewportHeight / rowHeight) + 1;
  const start: number = Math.max(0, Math.min(count - 1, first - overscan));
  const end: number = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(end, start + 1) };
}

/**
 * Windowed rendering for lists with a fixed row height. Only rows in (and
 * near) the viewport are mounted, so lists of any length render in constant time.
 */
export function useVirtualRows(
  container: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan: number = 8,
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(FALLBACK_VIEWPORT);
  // The scroll container can be unmounted and recreated while the hook stays
  // mounted (for example when the list is swapped for another view and back),
  // so track the element itself rather than the ref object.
  const [element, setElement] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (container.current !== element) setElement(container.current);
  });

  useLayoutEffect(() => {
    if (element === null) {
      return;
    }
    const measure = (): void => setViewportHeight(element.clientHeight > 0 ? element.clientHeight : FALLBACK_VIEWPORT);
    const onScroll = (): void => setScrollTop(element.scrollTop);
    measure();
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer: ResizeObserver | null = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [element]);

  const ensureVisible = useCallback(
    (index: number): void => {
      const element: HTMLElement | null = container.current;
      if (element === null) {
        return;
      }
      const top: number = index * rowHeight;
      const bottom: number = top + rowHeight;
      const height: number = element.clientHeight > 0 ? element.clientHeight : FALLBACK_VIEWPORT;
      if (top < element.scrollTop) {
        element.scrollTop = top;
      } else if (bottom > element.scrollTop + height) {
        element.scrollTop = bottom - height;
      }
    },
    [container, rowHeight],
  );

  const { start, end } = computeWindow(count, rowHeight, scrollTop, viewportHeight, overscan);
  return { start, end, totalHeight: count * rowHeight, ensureVisible };
}
