import { describe, expect, it } from "vitest";

import { splitQuestion } from "./questions";

const SAMPLE = `¿Cómo querés que maneje las notificaciones de los cron jobs?

1. Solo Telegram (aviso al terminar cada job)
2. Telegram + resumen semanal en el chat de Hermes
3. Silencioso (corren sin avisar; solo me consultás si algo falla)

Respondé con el número y lo dejamos así.`;

describe("splitQuestion", () => {
  it("extracts the trailing numbered block and removes it from the prose", () => {
    const { text, question } = splitQuestion(`Listo, amigo 👍 Acá va:\n\n${SAMPLE}`);
    expect(question).not.toBeNull();
    expect(question?.prompt).toBe("¿Cómo querés que maneje las notificaciones de los cron jobs?");
    expect(question?.options.map((option) => option.title)).toEqual([
      "Solo Telegram (aviso al terminar cada job)",
      "Telegram + resumen semanal en el chat de Hermes",
      "Silencioso (corren sin avisar; solo me consultás si algo falla)",
    ]);
    expect(text).toBe("Listo, amigo 👍 Acá va:");
    expect(text).not.toContain("Respondé con el número");
  });

  it("splits a bold title from its description", () => {
    const { question } = splitQuestion(
      "¿Qué opción preferís?\n\n1. **Rápida** — gasta más CPU\n2. **Económica** — tarda más",
    );
    expect(question?.options[0]).toEqual({
      title: "Rápida",
      description: "gasta más CPU",
      value: "Rápida",
    });
  });

  it("accepts a question without an explicit answer instruction", () => {
    // Judgment Day round 1: requiring a choice verb hid real questions such
    // as this one. A question line plus a trailing numbered block is enough;
    // "Omitir" is the escape hatch when the list was really a step guide.
    const reply = "¿Qué hago con los archivos duplicados?\n\n1. Borrarlos\n2. Conservarlos";
    const { question } = splitQuestion(reply);
    expect(question?.options.map((option) => option.title)).toEqual(["Borrarlos", "Conservarlos"]);
  });

  it("understands imperative variants and keeps a trailing sentence", () => {
    const reply = "¿Qué canal preferís?\n\n1. Telegram\n2. Silencioso\n\nRespondeme con el número. Después seguimos.";
    const { text, question } = splitQuestion(reply);
    expect(question?.options).toHaveLength(2);
    expect(text).toBe("Después seguimos.");
  });

  it("still ignores a numbered block with no question above it", () => {
    const reply = "Pasos para publicar:\n\n1. Compilá\n2. Subí el artefacto";
    expect(splitQuestion(reply)).toEqual({ text: reply, question: null });
  });

  it("leaves short or out-of-order lists untouched", () => {
    const single = "¿Seguimos?\n\n1. Sí";
    expect(splitQuestion(single).question).toBeNull();
    const unordered = "¿Qué preferís?\n\n1. A\n3. B";
    expect(splitQuestion(unordered).question).toBeNull();
  });

  it("keeps the list when no question line precedes it", () => {
    const reply = "Pasos:\n\n1. uno\n2. dos";
    expect(splitQuestion(reply)).toEqual({ text: reply, question: null });
  });
});
