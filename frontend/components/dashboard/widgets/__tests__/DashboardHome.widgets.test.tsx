import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardHome from "@/components/containers/DashboardHome";
import { currentMonthKey } from "@/lib/dashboard/transforms";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
const monthKey = currentMonthKey(new Date());
const flowRows = [{ month: monthKey, income: "1000.00", expense: "400.00" }];
const q = (data: unknown) => ({ data, error: undefined, isLoading: false });
const seenPatch: unknown[] = [];
let layoutWidgets: Array<{ id: string; type: string; order: number; size: string }> | null = null;
vi.mock("@/lib/api/dashboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api/dashboard")>();
  return { ...mod, useNetWorth: () => q({ per_currency: [] }), useMonthlyFlow: () => q(flowRows), useSpendByCategory: () => q([]), useBudgets: () => q([]), useHabitsToday: () => q([]), useAccounts: () => q([]),
    usePreferences: () => q({ preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: layoutWidgets ? { widgets: layoutWidgets } : null } }),
    useUpdateLayout: () => async (next: { widgets: unknown[] }) => { seenPatch.push({ dashboard_layout: next }); layoutWidgets = next.widgets as typeof layoutWidgets; } };
});
beforeEach(() => { seenPatch.length = 0; layoutWidgets = null; });
describe("DashboardHome month trio + toggles p8-pr2", () => {
  it("renders 3 independent month cards with formatMoney", async () => {
    render(<DashboardHome />);
    expect(await screen.findByText("Ingreso del mes")).toBeInTheDocument();
    expect(screen.getByText("Gasto del mes")).toBeInTheDocument();
    expect(screen.getByText("Ahorro del mes")).toBeInTheDocument();
    expect(screen.getAllByText(/1\.000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/400/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/600/).length).toBeGreaterThanOrEqual(1);
  });
  it("toggles hide one card with exact PATCH envelope and round-trips", async () => {
    render(<DashboardHome />);
    await screen.findByText("Ingreso del mes");
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(switches[0]);
    await waitFor(() => expect(seenPatch.length).toBe(1));
    expect(seenPatch[0]).toEqual({ dashboard_layout: expect.objectContaining({ widgets: expect.any(Array) }) });
    expect((seenPatch[0] as { dashboard_layout: { widgets: Array<{ id: string }> } }).dashboard_layout.widgets.some((w) => w.id === "month-income")).toBe(false);
  });
});
