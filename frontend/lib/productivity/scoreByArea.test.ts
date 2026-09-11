import { describe, expect, it } from "vitest";
import { scoreByArea } from "./scoreByArea";

describe("scoreByArea S4 RED", () => {
  it("devuelve 4 indicadores etiquetados, uno por área", () => {
    const scores = scoreByArea({ finance: 80, habits: 60, goals: 40, productivity: 20 });
    expect(scores.map((s) => s.area)).toEqual(["finance", "habits", "goals", "productivity"]);
    expect(scores.map((s) => s.value)).toEqual([80, 60, 40, 20]);
    expect(scores.every((s) => s.hasData)).toBe(true);
  });

  it("área sin datos → visual neutro, nunca fabrica puntaje", () => {
    const scores = scoreByArea({ finance: 80, habits: null, goals: undefined, productivity: NaN });
    expect(scores.filter((s) => !s.hasData).map((s) => s.area)).toEqual([
      "habits",
      "goals",
      "productivity",
    ]);
    expect(scores.filter((s) => !s.hasData).every((s) => s.value === null)).toBe(true);
  });

  it("normaliza entradas a 0–100 sin nota única global", () => {
    const scores = scoreByArea({ finance: 150, habits: -20, goals: 55.55, productivity: 0 });
    expect(scores.map((s) => s.value)).toEqual([100, 0, 55.6, 0]);
    expect(scores).not.toHaveProperty("overall");
    expect(scores).not.toHaveProperty("total");
  });
});
