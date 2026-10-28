import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ThoughtAccordion from "./ThoughtAccordion";

describe("ThoughtAccordion", () => {
  it("stays collapsed until the header is clicked", () => {
    render(<ThoughtAccordion entries={[{ kind: "thinking", text: "analizo la pregunta" }]} />);
    expect(screen.queryByText("analizo la pregunta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("analizo la pregunta")).toBeInTheDocument();
  });

  it("names the running tool in the header", () => {
    render(
      <ThoughtAccordion
        streaming
        entries={[
          { kind: "thinking", text: "necesito datos" },
          {
            kind: "tool",
            tool: { tool: "terminal", label: "ls -A /opt/data", status: "running", emoji: "💻" },
          },
        ]}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Llamando a terminal");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/ls -A \/opt\/data/)).toBeInTheDocument();
    expect(screen.getByText(/en curso/)).toBeInTheDocument();
  });

  it("falls back to Pensamiento once the tool completed", () => {
    render(
      <ThoughtAccordion
        entries={[
          { kind: "tool", tool: { tool: "terminal", status: "completed", toolCallId: "c1" } },
        ]}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Pensamiento");
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<ThoughtAccordion entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
