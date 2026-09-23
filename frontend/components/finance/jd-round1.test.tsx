import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { AssetEditForm } from "./AssetForms";
import { t } from "@/lib/i18n";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithSWR(ui: React.ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

describe("JD-ASSET AssetEditForm preserva categoría (RED)", () => {
  it("renombrar preserva categoría almacenada", async () => {
    let seen: Record<string, unknown> | null = null;
    server.use(
      http.patch("http://test.local/api/assets/a1", async ({ request }) => {
        seen = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "a1" });
      }),
    );
    renderWithSWR(
      <AssetEditForm
        assetId="a1"
        accounts={[{ id: "acc1", name: "Billetera" }]}
        initial={{ name: "Apartamento", category: "property" }}
        onDone={() => undefined}
      />,
    );
    // La categoría almacenada debe precargarse, no resetear a "other".
    expect(screen.getByLabelText(t("finance.category"))).toHaveValue("property");
    fireEvent.change(screen.getByLabelText(t("finance.goalName")), {
      target: { value: "Apartamento 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen!.name).toBe("Apartamento 2");
    expect(seen!.category).toBe("property");
  });
});

describe("JD triangulate (bordes + defaults)", () => {
  it("toAssetEditInitial sin categoría → null (form defaultea other)", async () => {
    const { toAssetEditInitial } = await import("@/components/containers/FinanceScreens");
    // toAssetEditInitial sin categoría → null (form defaultea other).
    const init = toAssetEditInitial({ id: "a9", name: "Caja" });
    expect(init.category).toBeNull();
    const r2 = renderWithSWR(
      <AssetEditForm assetId="a9" accounts={[{ id: "acc1", name: "Billetera" }]} onDone={() => undefined} />,
    );
    expect(screen.getByLabelText(t("finance.category"))).toHaveValue("other");
    r2.unmount();
  });
});
