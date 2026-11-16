import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { PANEL_LIMITS, usePreferences, type PanelId } from "../stores/preferences";

const KEY_STEP = 16;

interface SplitterProps {
  panel: PanelId;
  label: string;
  /**
   * Which way the pointer moves to grow the panel: "right" for a panel left of
   * the splitter, "left" for a panel right of it, "up" for a panel below it.
   */
  grows: "right" | "left" | "up";
}

/**
 * Accessible panel resizer (WAI-ARIA window splitter pattern): drag, arrow
 * keys (16 px), Home/End for the limits, double-click to reset. The size is
 * persisted through the preferences store.
 */
export function Splitter({ panel, label, grows }: SplitterProps) {
  const size: number = usePreferences((state) => state.sizes[panel]);
  const setSize = usePreferences((state) => state.setSize);
  const resetSize = usePreferences((state) => state.resetSize);
  const drag = useRef<{ start: number; size: number } | null>(null);
  const horizontal: boolean = grows === "up";
  const limits = PANEL_LIMITS[panel];

  const position = (event: PointerEvent<HTMLDivElement>): number => (horizontal ? event.clientY : event.clientX);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: position(event), size };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) {
      return;
    }
    const delta: number = position(event) - drag.current.start;
    setSize(panel, drag.current.size + (grows === "right" ? delta : -delta));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const growKey: string = grows === "right" ? "ArrowRight" : grows === "left" ? "ArrowLeft" : "ArrowUp";
    const shrinkKey: string = grows === "right" ? "ArrowLeft" : grows === "left" ? "ArrowRight" : "ArrowDown";
    let next: number | null = null;
    if (event.key === growKey) next = size + KEY_STEP;
    else if (event.key === shrinkKey) next = size - KEY_STEP;
    else if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = limits.max;
    if (next !== null) {
      event.preventDefault();
      setSize(panel, next);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-valuenow={size}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      title={`${label} (double-click to reset)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => resetSize(panel)}
      onKeyDown={onKeyDown}
      // A 9 px hit area that occupies 1 px of layout; the visible line is the inner span.
      className={`group relative z-10 flex shrink-0 touch-none justify-center outline-none ${
        horizontal ? "-my-1 h-[9px] w-full cursor-row-resize flex-col" : "-mx-1 h-full w-[9px] cursor-col-resize"
      }`}
    >
      <span
        aria-hidden
        className={`bg-border transition-colors duration-100 group-hover:bg-accent group-focus-visible:bg-accent ${
          horizontal ? "h-px w-full" : "h-full w-px"
        }`}
      />
    </div>
  );
}
