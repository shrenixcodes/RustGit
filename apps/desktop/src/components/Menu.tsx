import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  /** Shown after the label in muted text. */
  hint?: string | undefined;
  disabled?: boolean;
  destructive?: boolean;
  run: () => void;
}

interface MenuProps {
  /** Accessible name of the trigger. */
  label: string;
  items: readonly MenuItem[];
  trigger: ReactNode;
  className?: string;
  disabled?: boolean;
  align?: "start" | "end";
}

/**
 * A menu button (WAI-ARIA menu button pattern): opens on click, Enter,
 * Space or ArrowDown; arrows move, Enter runs, Escape closes and returns
 * focus to the trigger.
 */
export function Menu({ label, items, trigger, className = "", disabled = false, align = "start" }: MenuProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [active, setActive] = useState<number>(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId: string = useId();
  const enabled: number[] = items.flatMap((item, index) => (item.disabled === true ? [] : [index]));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const openMenu = (): void => {
    setActive(enabled[0] ?? 0);
    setOpen(true);
  };

  const move = (delta: number): void => {
    if (enabled.length === 0) return;
    const position: number = enabled.indexOf(active);
    setActive(enabled[(position + delta + enabled.length) % enabled.length] ?? 0);
  };

  const runItem = (item: MenuItem | undefined): void => {
    if (item === undefined || item.disabled === true) return;
    close();
    item.run();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu();
          }
        }}
        className={className}
      >
        {trigger}
      </button>
      {open && (
        <ul
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${menuId}-${active}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") move(1);
            else if (event.key === "ArrowUp") move(-1);
            else if (event.key === "Home") setActive(enabled[0] ?? 0);
            else if (event.key === "End") setActive(enabled[enabled.length - 1] ?? 0);
            else if (event.key === "Enter" || event.key === " ") runItem(items[active]);
            else if (event.key === "Escape" || event.key === "Tab") close();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
          className={`absolute top-full z-30 mt-1 min-w-56 rounded-sm border border-border bg-elevated py-1 shadow-popover outline-none ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`${menuId}-${index}`}
              role="menuitem"
              aria-disabled={item.disabled === true || undefined}
              onPointerEnter={() => item.disabled !== true && setActive(index)}
              onClick={() => runItem(item)}
              className={`flex cursor-default items-baseline gap-3 px-3 py-1.5 text-sm ${
                item.disabled === true
                  ? "text-fg-muted opacity-60"
                  : index === active
                    ? "bg-hover text-fg"
                    : item.destructive === true
                      ? "text-danger"
                      : "text-fg-secondary"
              }`}
            >
              <span className={item.destructive === true && item.disabled !== true ? "text-danger" : ""}>{item.label}</span>
              {item.hint !== undefined && <span className="ml-auto font-mono text-2xs text-fg-muted">{item.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
