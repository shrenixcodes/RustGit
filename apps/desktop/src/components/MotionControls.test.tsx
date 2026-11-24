import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";
import { Menu } from "./Menu";
import { ProgressLine } from "../app/ProgressLine";

afterEach(cleanup);

describe("motion & interactive primitives", () => {
  it("moves selection along SegmentedControl with arrow keys", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        options={[
          { value: "thread", label: "Thread" },
          { value: "map", label: "Map" },
        ]}
        value="thread"
        onChange={onChange}
      />,
    );
    const thread = screen.getByRole("radio", { name: "Thread" });
    fireEvent.keyDown(thread, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("map");
  });

  it("opens Menu with popover animation classes and selects items", () => {
    const run = vi.fn();
    render(
      <Menu
        label="Actions"
        trigger={<span>Open</span>}
        align="end"
        items={[{ id: "one", label: "First action", run }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(menu.className).toContain("rg-popover-anim");
    expect(menu.className).toContain("origin-top-right");
    fireEvent.click(screen.getByRole("menuitem", { name: "First action" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("renders indeterminate sweep when ProgressLine has no total counts and smooth width when counting", () => {
    const base = {
      operationId: "op-1",
      kind: "fetch" as const,
      label: "Fetch origin",
      repositoryId: 1,
      cancellable: true,
      startedAt: 1,
      finishedAt: null,
      phase: "counting",
      progress: null,
      outcome: "running" as const,
      error: null,
    };
    const { container, rerender } = render(<ProgressLine operation={base} />);
    expect(container.querySelector(".rg-progress-indeterminate")).not.toBeNull();

    rerender(<ProgressLine operation={{ ...base, progress: { current: 5, total: 10 } }} />);
    expect(container.querySelector(".rg-progress-indeterminate")).toBeNull();
    const fill = container.querySelector("[style*='50%']");
    expect(fill).not.toBeNull();
  });
});
