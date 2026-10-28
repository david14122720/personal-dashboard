import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InteractiveQuestionCard from "./InteractiveQuestionCard";
import type { HermesQuestion } from "@/lib/hermes/questions";

const QUESTION: HermesQuestion = {
  prompt: "¿Cómo querés las notificaciones?",
  options: [
    { title: "Solo Telegram", description: "aviso al terminar", value: "Solo Telegram" },
    { title: "Resumen semanal", value: "Resumen semanal" },
    { title: "Silencioso", value: "Silencioso" },
    { title: "Otro canal", value: "Otro canal" },
  ],
};

describe("InteractiveQuestionCard", () => {
  it("answers immediately when an option is chosen", () => {
    const onAnswer = vi.fn();
    render(<InteractiveQuestionCard question={QUESTION} onAnswer={onAnswer} />);
    expect(screen.getByText("¿Cómo querés las notificaciones?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Solo Telegram"));
    expect(onAnswer).toHaveBeenCalledWith("Solo Telegram");
    expect(screen.getByText("aviso al terminar")).toBeInTheDocument();
  });

  it("paginates option pages", () => {
    render(<InteractiveQuestionCard question={QUESTION} onAnswer={vi.fn()} />);
    expect(screen.getByText("1 de 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Opciones siguientes" }));
    expect(screen.getByText("2 de 2")).toBeInTheDocument();
    expect(screen.getByText("Otro canal")).toBeInTheDocument();
  });

  it("sends the free text through Otra cosa and the arrow", () => {
    const onAnswer = vi.fn();
    render(<InteractiveQuestionCard question={QUESTION} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText("Otra cosa"));
    const input = screen.getByRole("textbox", { name: "Otra cosa" });
    fireEvent.change(input, { target: { value: "  por mail  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta" }));
    expect(onAnswer).toHaveBeenCalledWith("por mail");
  });

  it("omits the question with the localized label", () => {
    const onAnswer = vi.fn();
    render(<InteractiveQuestionCard question={QUESTION} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText("Omitir"));
    expect(onAnswer).toHaveBeenCalledWith("Omitir");
  });

  it("locks every control once answered", () => {
    const onAnswer = vi.fn();
    render(
      <InteractiveQuestionCard question={QUESTION} answered="Solo Telegram" onAnswer={onAnswer} />,
    );
    expect(screen.getByTestId("hermes-question")).toHaveTextContent("Respondido: Solo Telegram");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the arrow until there is text", () => {
    render(<InteractiveQuestionCard question={QUESTION} onAnswer={vi.fn()} />);
    fireEvent.click(screen.getByText("Otra cosa"));
    const arrow = screen.getByRole("button", { name: "Enviar respuesta" });
    expect(arrow).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Otra cosa" }), {
      target: { value: "algo" },
    });
    expect(arrow).toBeEnabled();
  });
});
