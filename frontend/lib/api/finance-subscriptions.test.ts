import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { patchSubscription, paySubscription } from "./finance";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seen: { method: string; path: string; body: unknown }[] = [];

const server = setupServer(
  http.post("http://test.local/api/subscriptions/:id/pay", async ({ params, request }) => {
    seen.push({ method: "POST", path: `/subscriptions/${params.id}/pay`, body: await request.json() });
    return HttpResponse.json({ id: params.id });
  }),
  http.patch("http://test.local/api/subscriptions/:id", async ({ params, request }) => {
    seen.push({ method: "PATCH", path: `/subscriptions/${params.id}`, body: await request.json() });
    return HttpResponse.json({ id: params.id });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

describe("subscription pay/patch hooks", () => {
  it("paySubscription posts only {account_id} to the pay endpoint", async () => {
    await paySubscription("s1", "a1");
    expect(seen).toEqual([{ method: "POST", path: "/subscriptions/s1/pay", body: { account_id: "a1" } }]);
  });

  it("patchSubscription sends the allowlisted metadata body", async () => {
    await patchSubscription("s1", { name: "Nuevo", price: "29900.00", next_billing_on: "2026-11-15" });
    expect(seen).toEqual([
      {
        method: "PATCH",
        path: "/subscriptions/s1",
        body: { name: "Nuevo", price: "29900.00", next_billing_on: "2026-11-15" },
      },
    ]);
  });
});
