import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WidgetToggle from "./WidgetToggle";

describe("WidgetToggle p8-pr2", () => {
  it("renders switch with aria-checked and toggles", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<WidgetToggle id="month-income" visible onToggle={onToggle} />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith(false);
    rerender(<WidgetToggle id="month-income" visible={false} onToggle={onToggle} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});
