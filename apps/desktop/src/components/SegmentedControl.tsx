import { useRef, type KeyboardEvent } from "react";

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
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex: number = Math.max(
    0,
    options.findIndex((option: SegmentOption<T>) => option.value === value),
  );

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
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="inline-flex rounded-sm border border-border bg-canvas p-0.5"
    >
      {options.map((option: SegmentOption<T>, index: number) => {
        const checked: boolean = option.value === value;
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
            className={`h-6 rounded-xs px-3 text-sm transition-colors duration-100 disabled:opacity-45 ${
              checked ? "bg-elevated font-medium text-fg shadow-glow" : "text-fg-secondary hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
