import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

/**
 * S6: the dashboard's default "today" must be the Bogota calendar day (the
 * same clock as `/habits/today` and `TodayHabits`), not the device clock.
 * The mocked Bogota day (Feb 2020) is far from the real run date, so a
 * device-clock default can never accidentally match the assertion.
 */
const { todayInBogota } = vi.hoisted(() => ({
  todayInBogota: vi.fn(() => "2020-02-15"),
}));

vi.mock("@/lib/finance/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finance/finance")>();
  return { ...actual, todayInBogota };
});

vi.mock("@/lib/api/productivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/productivity")>();
  return {
    ...actual,
    useHabitsList: () => ({ data: [], isLoading: false, error: undefined }),
    useHabitsHistory: () => ({ data: [], isLoading: false, error: undefined }),
  };
});

import HabitsDashboard from "./HabitsDashboard";

function renderDashboard() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HabitsDashboard />
    </SWRConfig>,
  );
}

describe("HabitsDashboard Bogota clock (S6)", () => {
  it("defaults today to todayInBogota, not the device clock", () => {
    renderDashboard();
    expect(todayInBogota).toHaveBeenCalled();
    // The visible month is anchored to the Bogota day: February 2020, 29 days.
    expect(screen.getByText("Febrero")).toBeInTheDocument();
    expect(screen.getByText("2020")).toBeInTheDocument();
    expect(screen.getByText("Ciclo Activo 29 Días")).toBeInTheDocument();
  });
});
