import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ApprovalRequestCard from "./ApprovalRequestCard";

const base = {
  tool: "terminal",
  command: "ls -A /opt/data",
  description: "List the data directory",
  decision: "idle" as const,
  error: null,
  onApprove: () => {},
  onDeny: () => {},
};

describe("ApprovalRequestCard", () => {
  it("renders the lock card with tool, command and both buttons", () => {
    render(<ApprovalRequestCard {...base} />);
    const card = screen.getByTestId("hermes-approval");
    expect(card).toHaveAttribute("role", "alert");
    expect(card).toHaveTextContent("terminal");
    expect(card.querySelector("pre")).toHaveTextContent("ls -A /opt/data");
    expect(card).toHaveTextContent("List the data directory");
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Denegar" })).toBeInTheDocument();
  });

  it("calls back on approve and deny", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(<ApprovalRequestCard {...base} onApprove={onApprove} onDeny={onDeny} />);
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    fireEvent.click(screen.getByRole("button", { name: "Denegar" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons and shows sending while pending", () => {
    render(<ApprovalRequestCard {...base} decision="pending" />);
    const buttons = screen.getAllByRole("button", { name: "Enviando…" });
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => expect(button).toBeDisabled());
  });

  it("shows the resolved state without buttons", () => {
    const { rerender } = render(<ApprovalRequestCard {...base} decision="approved" />);
    expect(screen.getByTestId("hermes-approval-resolved")).toHaveTextContent("Aprobado");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ApprovalRequestCard {...base} decision="denied" />);
    expect(screen.getByTestId("hermes-approval-resolved")).toHaveTextContent("Denegado");
  });

  it("shows the expiry notice without buttons", () => {
    render(<ApprovalRequestCard {...base} decision="expired" />);
    expect(screen.getByTestId("hermes-approval-resolved")).toHaveTextContent(
      "La aprobación expiró",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders without an optional description", () => {
    render(<ApprovalRequestCard {...base} description={null} />);
    expect(screen.getByTestId("hermes-approval").querySelector("pre")).toBeInTheDocument();
  });
});
