import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "@/lib/api/client";
import { createHabit } from "@/lib/api/productivity";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

let seenBody: Record<string, unknown> | null = null;
let mode: "ok" | "conflict" | "invalid" = "ok";

const server = setupServer(
  http.post("http://test.local/api/habits", async ({ request }) => {
    seenBody = (await request.json()) as Record<string, unknown>;
    if (mode === "conflict") {
      return HttpResponse.json({ code: "CONFLICT", message: "habit already exists" }, { status: 409 });
    }
    if (mode === "invalid") {
      return HttpResponse.json({ code: "VALIDATION", message: "bad" }, { status: 422 });
    }
    return HttpResponse.json(
      {
        id: "h-new",
        name: seenBody["name"],
        description: seenBody["description"] ?? null,
        direction: seenBody["direction"],
        frequency: seenBody["frequency"] ?? "daily",
        days_of_week: seenBody["days_of_week"] ?? [],
        target_per_period: seenBody["target_per_period"] ?? null,
        start_date: seenBody["start_date"] ?? "2026-09-20",
        end_date: seenBody["end_date"] ?? null,
        category_id: seenBody["category_id"] ?? null,
        color: seenBody["color"] ?? null,
        icon: seenBody["icon"] ?? null,
        is_archived: false,
        created_at: "2026-09-20T00:00:00Z",
        updated_at: "2026-09-20T00:00:00Z",
      },
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenBody = null;
  mode = "ok";
});
afterAll(() => server.close());

describe("createHabit", () => {
  it("posts the habit payload and strips empty strings", async () => {
    const habit = await createHabit({
      name: "Morning Run",
      direction: "build",
      frequency: "daily",
      description: "",
      color: "",
    });
    expect(habit).toMatchObject({ id: "h-new", name: "Morning Run", direction: "build" });
    expect(seenBody).toMatchObject({ name: "Morning Run", direction: "build", frequency: "daily" });
    expect(seenBody).not.toHaveProperty("description");
    expect(seenBody).not.toHaveProperty("color");
  });

  it("sends the custom weekday mask untouched", async () => {
    await createHabit({ name: "Read", direction: "build", frequency: "custom", days_of_week: [1, 3, 5] });
    expect(seenBody).toMatchObject({ frequency: "custom", days_of_week: [1, 3, 5] });
  });

  it("surfaces 409 duplicates as ApiError", async () => {
    mode = "conflict";
    const err = await createHabit({ name: "Morning Run", direction: "build" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it("surfaces 422 validation as ApiError", async () => {
    mode = "invalid";
    const err = await createHabit({ name: "x", direction: "build" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
  });
});
