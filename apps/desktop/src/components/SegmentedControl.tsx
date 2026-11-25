import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** A radio group rendered as segments. Arrow keys move and select, as in native radio groups. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const hasSelection: boolean = value !== undefined && options.some((option) => option.value === value);
  const selectedIndex: number = Math.max(
    0,
    options.findIndex((option: SegmentOption<T>) => option.value === value),
  );
  const [thumb, setThumb] = useState<{ x: number; width: number; animate: boolean } | null>(null);
  const positioned = useRef<boolean>(false);

  const syncThumb = useCallback(() => {
    if (!hasSelection) {
      setThumb(null);
      return;
    }
    const target: HTMLButtonElement | null | undefined = buttons.current[selectedIndex];
    if (!target || target.offsetWidth <= 0) {
      setThumb(null);
      return;
    }
    const nextX: number = target.offsetLeft;
    const nextWidth: number = target.offsetWidth;
    const animate: boolean = positioned.current;
    positioned.current = true;
    setThumb({ x: nextX, width: nextWidth, animate });
  }, [hasSelection, selectedIndex]);

  useLayoutEffect(() => {
    syncThumb();
    const element: HTMLDivElement | null = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncThumb);
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncThumb, options]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step: number =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next: number = (selectedIndex + step + options.length) % options.length;
    const option: SegmentOption<T> | undefined = options[next];
    if (option !== undefined) {
      onChange(option.value);
      buttons.current[next]?.focus();
    }
  };

  return (
    <div
      ref={container}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="relative inline-flex rounded-md border border-border/70 bg-canvas/80 p-0.5 shadow-2xs"
    >
      {thumb !== null && (
        <span
          aria-hidden
          style={{
            width: thumb.width,
            transform: `translateX(${thumb.x - 2}px)`,
            transitionDuration: thumb.animate ? "var(--rg-duration-base)" : "0ms",
            transitionTimingFunction: "var(--rg-ease-out)",
          }}
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-sm bg-elevated shadow-xs ring-1 ring-border/40 transition-[transform,width]"
        />
      )}
      {options.map((option: SegmentOption<T>, index: number) => {
        const checked: boolean = option.value === value;
        const staticActive: string =
          thumb === null ? "bg-elevated shadow-xs ring-1 ring-border/40" : "";
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === selectedIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`relative z-10 h-6.5 rounded-sm px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40 ${
              checked
                ? `${staticActive} font-medium text-fg`
                : "text-fg-secondary hover:text-fg hover:bg-hover/40"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
