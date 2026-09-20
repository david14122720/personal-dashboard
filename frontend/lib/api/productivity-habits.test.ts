import { createElement as h } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SWRConfig } from "swr";
import { ApiError } from "@/lib/api/client";
import {
  archiveHabit,
  createHabit,
  deleteHabitLog,
  toggleHabitLog,
  useHabitsList,
} from "@/lib/api/productivity";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

let seenBody: Record<string, unknown> | null = null;
let mode: "ok" | "conflict" | "invalid" = "ok";
let logPostMode: "ok" | "conflict" = "ok";

const seenLogPosts: Array<{ id: string; body: Record<string, unknown> }> = [];
const seenLogPatches: Array<{ id: string; date: string; body: Record<string, unknown> }> = [];
const seenLogDeletes: Array<{ id: string; date: string }> = [];
const seenHabitPatches: Array<{ id: string; body: Record<string, unknown> }> = [];

function wire(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "h-new",
    name: overrides.name ?? "Morning Run",
    description: overrides.description ?? null,
    direction: overrides.direction ?? "build",
    frequency: overrides.frequency ?? "daily",
    days_of_week: overrides.days_of_week ?? [],
    target_per_period: overrides.target_per_period ?? null,
    start_date: overrides.start_date ?? "2026-09-20",
    end_date: overrides.end_date ?? null,
    category_id: overrides.category_id ?? null,
    category: overrides.category ?? null,
    short_label: overrides.short_label ?? null,
    color: overrides.color ?? null,
    icon: overrides.icon ?? null,
    is_archived: overrides.is_archived ?? false,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
  };
}

const server = setupServer(
  http.get("http://test.local/api/habits", () =>
    HttpResponse.json([wire({ id: "h1", name: "Agua", category: "Salud & Físico", short_label: "1L" })]),
  ),
  http.post("http://test.local/api/habits", async ({ request }) => {
    seenBody = (await request.json()) as Record<string, unknown>;
    if (mode === "conflict") {
      return HttpResponse.json({ code: "CONFLICT", message: "habit already exists" }, { status: 409 });
    }
    if (mode === "invalid") {
      return HttpResponse.json({ code: "VALIDATION", message: "bad" }, { status: 422 });
    }
    return HttpResponse.json(wire(seenBody), { status: 201 });
  }),
  http.patch("http://test.local/api/habits/:id", async ({ params, request }) => {
    seenHabitPatches.push({ id: params.id as string, body: (await request.json()) as Record<string, unknown> });
    return HttpResponse.json(wire({ id: params.id as string, is_archived: true }));
  }),
  http.post("http://test.local/api/habits/:id/logs", async ({ params, request }) => {
    seenLogPosts.push({ id: params.id as string, body: (await request.json()) as Record<string, unknown> });
    if (logPostMode === "conflict") {
      return HttpResponse.json({ code: "CONFLICT", message: "log exists" }, { status: 409 });
    }
    return HttpResponse.json({ id: "log1" }, { status: 201 });
  }),
  http.patch("http://test.local/api/habits/:id/logs/:date", async ({ params, request }) => {
    seenLogPatches.push({
      id: params.id as string,
      date: params.date as string,
      body: (await request.json()) as Record<string, unknown>,
    });
    return HttpResponse.json({ id: "log1" });
  }),
  http.delete("http://test.local/api/habits/:id/logs/:date", ({ params }) => {
    seenLogDeletes.push({ id: params.id as string, date: params.date as string });
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenBody = null;
  mode = "ok";
  logPostMode = "ok";
  seenLogPosts.length = 0;
  seenLogPatches.length = 0;
  seenLogDeletes.length = 0;
  seenHabitPatches.length = 0;
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

  it("forwards category and short_label, omitting blanks", async () => {
    await createHabit({ name: "Run", direction: "build", category: "Salud & Físico", short_label: "45m" });
    expect(seenBody).toMatchObject({ category: "Salud & Físico", short_label: "45m" });
    await createHabit({ name: "Run", direction: "build", category: "", short_label: "" });
    expect(seenBody).not.toHaveProperty("category");
    expect(seenBody).not.toHaveProperty("short_label");
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

describe("habit log mutations", () => {
  it("deletes one log by habit and date (204 resolves)", async () => {
    await expect(deleteHabitLog("h1", "2026-09-15")).resolves.toBeUndefined();
    expect(seenLogDeletes).toEqual([{ id: "h1", date: "2026-09-15" }]);
  });

  it("toggle on a done cell deletes and never posts", async () => {
    await toggleHabitLog("h1", "2026-09-15", true);
    expect(seenLogDeletes).toEqual([{ id: "h1", date: "2026-09-15" }]);
    expect(seenLogPosts).toHaveLength(0);
  });

  it("toggle on an unlogged cell posts done for that exact date", async () => {
    await toggleHabitLog("h1", "2026-09-10", false);
    expect(seenLogPosts).toEqual([{ id: "h1", body: { log_date: "2026-09-10", status: "done" } }]);
    expect(seenLogDeletes).toHaveLength(0);
  });

  it("falls back to PATCH when the log already exists (409)", async () => {
    logPostMode = "conflict";
    await toggleHabitLog("h1", "2026-09-10", false);
    expect(seenLogPosts).toHaveLength(1);
    expect(seenLogPatches).toEqual([{ id: "h1", date: "2026-09-10", body: { status: "done" } }]);
  });
});

describe("archiveHabit", () => {
  it("patches is_archived and returns the updated wire", async () => {
    const habit = await archiveHabit("h1", true);
    expect(seenHabitPatches).toEqual([{ id: "h1", body: { is_archived: true } }]);
    expect(habit).toMatchObject({ id: "h1", is_archived: true });
  });
});

describe("useHabitsList", () => {
  it("reads GET /habits through SWR", async () => {
    const { result } = renderHook(() => useHabitsList(), {
      wrapper: ({ children }) =>
        h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      expect.objectContaining({ id: "h1", name: "Agua", category: "Salud & Físico", short_label: "1L" }),
    ]);
  });
});
