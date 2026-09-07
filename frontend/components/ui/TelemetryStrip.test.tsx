import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TelemetryStrip from "./TelemetryStrip";

describe("TelemetryStrip enum mapping", () => {
  it("renders warn and over LEDs with their visual states", () => {
    render(
      <TelemetryStrip
        items={[
          { id: "card", label: "Cards", display: "warn", status: "warn" },
          { id: "budgets", label: "Budgets", display: "over", status: "over" },
          { id: "worth", label: "Net worth", display: "$ 1.500.000" },
        ]}
      />,
    );

    const warnLed = screen.getByRole("img", { name: "Cards status warn" });
    const overLed = screen.getByRole("img", { name: "Budgets status over" });
    expect(warnLed.className).toContain("bg-signal");
    expect(overLed.className).toContain("bg-alert");
  });

  it("maps high to the alert state and ok to the flow state", () => {
    render(
      <TelemetryStrip
        items={[
          { id: "card", label: "Cards", display: "high", status: "high" },
          { id: "month", label: "Month balance", display: "$ 100", status: "ok" },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Cards status high" }).className).toContain("bg-alert");
    expect(screen.getByRole("img", { name: "Month balance status ok" }).className).toContain(
      "bg-flow",
    );
  });

  it("omits the LED when no status applies", () => {
    render(<TelemetryStrip items={[{ id: "worth", label: "Net worth", display: "$ 5" }]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("$ 5")).toBeInTheDocument();
  });
});
