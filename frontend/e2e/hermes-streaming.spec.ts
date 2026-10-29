import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes Runs streaming UI (ODD `hermes-runs-aprobaciones`, S3–S10 + S12–S13).
 *
 * The proxy's Runs contract is stubbed at the network boundary:
 * - `POST /api/hermes/runs` → `202 {runId, sessionId, createdAt}`
 * - `GET /api/hermes/runs/{id}` → `200 {runId, status, ...}`
 * - `GET /api/hermes/runs/{id}/events` → `text/event-stream` with **verbatim
 *   gateway framing**: comment lines (`: open`, `: keepalive`), `id: N`
 *   lines and `data: {...}` lines. There is NO `event:` line; the event name
 *   lives in the JSON `event` field.
 * - `POST /api/hermes/runs/{id}/approval` → `200 {runId, choice, resolved}`.
 *
 * The spec drives the real timer, thought accordion, question card, approval
 * card and queue without a live Hermes server:
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-streaming
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const SESSION_ID = "7f3c1d2e-1111-4aaa-9bbb-00000000e2e1";
const RUN_1 = "run_e2e_1";
const RUN_2 = "run_e2e_2";

function dataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function commentFrame(text: string): string {
  return `: ${text}\n\n`;
}

function idFrame(n: number): string {
  return `id: ${n}\n\n`;
}

const QUESTION = [
  "Listo, amigo 👍 Acá va:",
  "",
  "¿Cómo querés que maneje las notificaciones de los cron jobs?",
  "",
  "1. Solo Telegram — aviso al terminar cada job",
  "2. Telegram + resumen semanal — en el chat de Hermes",
  "3. Silencioso — corren sin avisar; solo consultan si algo falla",
  "4. Por email — resumen diario a la mañana",
  "",
  "Respondé con el número y lo dejamos así.",
].join("\n");

interface CreateCall {
  sessionId: unknown;
  message: unknown;
}

interface RunsHarness {
  creates: CreateCall[];
  approvals: { body: string; runId: string }[];
  eventsHits: string[];
  nextRunIds: string[];
  eventsBodies: Map<string, string | (() => Promise<string>)>;
  statusOf: (runId: string) => Record<string, unknown>;
}

function newHarness(): RunsHarness {
  return {
    creates: [],
    approvals: [],
    eventsHits: [],
    nextRunIds: [RUN_1, RUN_2],
    eventsBodies: new Map(),
    statusOf: (runId: string) => ({
      runId,
      status: "running",
      sessionId: SESSION_ID,
      createdAt: Date.now(),
      executionGeneration: 0,
      output: "",
      usage: {},
      completed: false,
      partial: false,
      interrupted: false,
      error: null,
      pendingControls: null,
    }),
  };
}

/** One dispatcher for the whole Runs surface; routes never overlap by accident. */
async function installRuns(page: Page, harness: RunsHarness): Promise<void> {
  await page.route("**/api/hermes/runs**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path.endsWith("/events")) {
      const runId = path.split("/").slice(-2, -1)[0] ?? "";
      harness.eventsHits.push(req.url());
      const body = harness.eventsBodies.get(runId) ?? harness.eventsBodies.get("*");
      const text = typeof body === "function" ? await body() : (body ?? "");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: text,
      });
      return;
    }
    if (path.endsWith("/approval") && req.method() === "POST") {
      const runId = path.split("/").slice(-2, -1)[0] ?? "";
      const raw = req.postData() ?? "";
      harness.approvals.push({ body: raw, runId });
      let choice: unknown = "once";
      try {
        choice = (JSON.parse(raw) as { choice?: unknown }).choice ?? "once";
      } catch {
        // Keep the default; the raw body is what the test asserts on.
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, choice, resolved: true }),
      });
      return;
    }
    if (req.method() === "POST" && /\/api\/hermes\/runs\/?$/.test(path)) {
      let payload: { sessionId?: unknown; message?: unknown } = {};
      try {
        payload = JSON.parse(req.postData() ?? "{}") as {
          sessionId?: unknown;
          message?: unknown;
        };
      } catch {
        payload = {};
      }
      harness.creates.push({ sessionId: payload.sessionId, message: payload.message });
      const runId = harness.nextRunIds[harness.creates.length - 1] ?? `run_e2e_${harness.creates.length}`;
      await route.fulfill({
        status: 202,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : SESSION_ID,
          createdAt: Date.now(),
        }),
      });
      return;
    }
    if (req.method() === "GET") {
      const runId = path.split("/").pop() ?? "";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(harness.statusOf(runId)),
      });
      return;
    }
    await route.fallback();
  });
}

/**
 * Totally ordered event delivery for timing-sensitive tests (approval,
 * timer-survives-delta). `route.fulfill` delivers the whole body at once and
 * the UI would batch `approval.request` + `run.completed` into one render —
 * the approval card would never paint. Patching `fetch` for the events URL
 * only keeps the stub at the network boundary with identical verbatim framing.
 */
async function installControllableEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface StreamCtl {
      queue: string[];
      closed: boolean;
      wake: () => void;
    }
    const states = new Map<string, StreamCtl>();
    const get = (runId: string): StreamCtl => {
      let state = states.get(runId);
      if (!state) {
        state = { queue: [], closed: false, wake: () => undefined };
        states.set(runId, state);
      }
      return state;
    };
    (window as unknown as { __hermesPush: (runId: string, chunk: string) => void }).__hermesPush = (
      runId,
      chunk,
    ) => {
      const state = get(runId);
      state.queue.push(chunk);
      state.wake();
    };
    (window as unknown as { __hermesClose: (runId: string) => void }).__hermesClose = (runId) => {
      const state = get(runId);
      state.closed = true;
      state.wake();
    };
    const originalFetch = window.fetch.bind(window);
    const patched: typeof window.fetch = (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const match = /\/api\/hermes\/runs\/([^/?#]+)\/events$/.exec(url);
      if (!match) return originalFetch(input, init);
      const runId = match[1];
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const state = get(runId);
          for (;;) {
            const next = state.queue.shift();
            if (next !== undefined) {
              controller.enqueue(encoder.encode(next));
              continue;
            }
            if (state.closed) {
              controller.close();
              return;
            }
            await new Promise<void>((resolve) => {
              state.wake = resolve;
              window.setTimeout(resolve, 500);
            });
          }
        },
      });
      return Promise.resolve(
        new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
        }),
      );
    };
    window.fetch = patched;
  });
}

async function pushRaw(page: Page, runId: string, chunk: string): Promise<void> {
  await page.evaluate(
    ([id, text]: [string, string]) => {
      (window as unknown as { __hermesPush: (runId: string, chunk: string) => void }).__hermesPush(
        id,
        text,
      );
    },
    [runId, chunk] as [string, string],
  );
}

async function pushEvent(page: Page, runId: string, payload: unknown): Promise<void> {
  await pushRaw(page, runId, dataFrame(payload));
}

async function closeStream(page: Page, runId: string): Promise<void> {
  await page.evaluate((id: string) => {
    (window as unknown as { __hermesClose: (runId: string) => void }).__hermesClose(id);
  }, runId);
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.locator("#hermes-input").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test.describe("Hermes runs streaming", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(async ({ page }) => {
    // A real session: the shell fetches `/api/me` on mount and a fake token
    // would bounce every test to `/login/`.
    await page.addInitScript((sid: string) => {
      localStorage.setItem("hermes_session_id", sid);
    }, SESSION_ID);
    await loginViaApi(page);
  });

  test("counts the wait in MM:SS and collapses the reasoning by default", async ({ page }) => {
    const harness = newHarness();
    harness.eventsBodies.set(
      RUN_1,
      () =>
        new Promise<string>((resolve) => {
          // Delayed fulfill: the whole body arrives at once, so the live
          // clock must already be counting before the first frame lands.
          setTimeout(() => {
            resolve(
              commentFrame("open") +
                idFrame(1) +
                dataFrame({ event: "reasoning.available", text: "El usuario pide un trabajo largo. " }) +
                dataFrame({ event: "reasoning.available", text: "Voy a mirar el disco." }) +
                idFrame(2) +
                dataFrame({ event: "tool.started", tool: "terminal", preview: "ls -A /opt/data" }) +
                dataFrame({ event: "message.delta", delta: "Encontré 41 archivos." }) +
                dataFrame({ event: "tool.completed", tool: "terminal", preview: "", error: false }) +
                dataFrame({
                  event: "run.completed",
                  output: "Encontré 41 archivos.",
                  usage: {},
                  completed: true,
                  partial: false,
                  interrupted: false,
                }),
            );
          }, 1_200);
        }),
    );
    await installRuns(page, harness);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "hacé un trabajo largo");

    const clock = page.getByTestId("hermes-elapsed");
    await expect(clock).toBeVisible();
    await expect(clock).toContainText("00:0");
    await expect(page.getByText("Hermes está trabajando...")).toBeVisible();

    const thought = page.getByTestId("hermes-thought").first();
    await expect(thought).toBeVisible();
    await expect(thought).toContainText("Llamando a terminal");
    // Collapsed by default: the reasoning is not part of the document yet.
    await expect(page.getByText("Voy a mirar el disco.")).toHaveCount(0);

    await thought.getByRole("button").click();
    await expect(page.getByText("El usuario pide un trabajo largo.")).toBeVisible();
    await expect(page.getByText(/ls -A \/opt\/data/)).toBeVisible();

    await expect(page.getByText("Encontré 41 archivos.")).toBeVisible();
    await expect(page.getByTestId("hermes-elapsed")).toHaveCount(0);
  });

  test("turns numbered choices into a card and sends the answer as the next turn", async ({
    page,
  }) => {
    const harness = newHarness();
    const completed = (output: string): string =>
      dataFrame({
        event: "run.completed",
        output,
        usage: {},
        completed: true,
        partial: false,
        interrupted: false,
      });
    harness.eventsBodies.set(RUN_1, dataFrame({ event: "message.delta", delta: QUESTION.slice(0, 20) }) + completed(QUESTION));
    harness.eventsBodies.set(RUN_2, completed("Listo, quedó configurado."));
    await installRuns(page, harness);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "configurá las notificaciones");

    const card = page.getByTestId("hermes-question");
    await expect(card).toBeVisible();
    await expect(card).toContainText("¿Cómo querés que maneje las notificaciones");
    // Four options paginate 3 + 1: first page shows 3 option buttons plus the
    // "Otra cosa" and "Omitir" actions and the two pagination arrows.
    await expect(card).toContainText("1 de 2");
    await expect(card.getByRole("button", { name: "Omitir" })).toBeVisible();
    await expect(card.getByRole("button", { name: /Otra cosa/ })).toBeVisible();
    const markdown = page.getByTestId("hermes-markdown").first();
    await expect(markdown).not.toContainText("Solo Telegram");
    await expect(markdown).not.toContainText("Respondé con el número");

    await card.getByText("Telegram + resumen semanal").click();
    await expect(card).toContainText("Respondido: Telegram + resumen semanal");
    await expect(page.locator('[data-role="user"]').last()).toContainText(
      "Telegram + resumen semanal",
    );
    // D1: the chosen answer travels as the next run of the same session.
    expect(harness.creates).toHaveLength(2);
    expect(harness.creates[1]?.message).toBe("Telegram + resumen semanal");
    await expect(page.getByText("Listo, quedó configurado.")).toBeVisible();
  });

  test("keeps one scroll container and no inner scrollbars", async ({ page }) => {
    const harness = newHarness();
    const long = Array.from({ length: 40 }, (_, index) => `Línea ${index + 1} de la respuesta.`).join(
      "\n",
    );
    harness.eventsBodies.set(
      RUN_1,
      dataFrame({
        event: "run.completed",
        output: long,
        usage: {},
        completed: true,
        partial: false,
        interrupted: false,
      }),
    );
    await installRuns(page, harness);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "dame una respuesta larga");
    await expect(page.getByText("Línea 40 de la respuesta.")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const log = document.querySelector('[data-testid="hermes-log"]');
      const bubbles = Array.from(document.querySelectorAll('[data-role="assistant"] > div'));
      return {
        logOverflow: log ? getComputedStyle(log).overflowY : "missing",
        logScrolls: log ? log.scrollHeight > log.clientHeight : false,
        inner: bubbles.filter((node) => {
          const style = getComputedStyle(node);
          return (
            (style.overflowY === "auto" || style.overflowY === "scroll") &&
            node.scrollHeight > node.clientHeight + 1
          );
        }).length,
      };
    });
    expect(metrics.logOverflow).toBe("auto");
    expect(metrics.logScrolls).toBe(true);
    expect(metrics.inner).toBe(0);
  });

  test("ignores keepalive comments and id cursors (S4)", async ({ page }) => {
    const harness = newHarness();
    harness.eventsBodies.set(
      RUN_1,
      commentFrame("open") +
        commentFrame("keepalive") +
        idFrame(0) +
        dataFrame({ event: "message.delta", delta: "hola, sigo vivo" }) +
        commentFrame("keepalive") +
        idFrame(1) +
        dataFrame({
          event: "run.completed",
          output: "hola, sigo vivo",
          usage: {},
          completed: true,
          partial: false,
          interrupted: false,
        }) +
        commentFrame("stream closed"),
    );
    await installRuns(page, harness);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "ping");

    await expect(page.getByText("hola, sigo vivo")).toBeVisible();
    await expect(page.getByText("keepalive")).toHaveCount(0);
    await expect(page.getByText(": open")).toHaveCount(0);
    await expect(page.getByText("id: 0")).toHaveCount(0);
    await expect(page.getByText("stream closed")).toHaveCount(0);
  });

  test("shows the approval card and approves with requestId + generation (S7/S8)", async ({
    page,
  }) => {
    const harness = newHarness();
    await installRuns(page, harness);
    await installControllableEvents(page);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "borrá /tmp/x");
    await expect(page.getByTestId("hermes-elapsed")).toBeVisible();

    await pushRaw(page, RUN_1, commentFrame("open") + idFrame(0));
    await pushEvent(page, RUN_1, {
      event: "approval.request",
      kind: "approval",
      prompt_id: "p-1",
      execution_generation: 1,
      command: "rm -rf /tmp/x",
      description: "delete in root path",
      choices: ["once", "deny", "session", "always"],
    });

    const card = page.getByTestId("hermes-approval");
    await expect(card).toBeVisible();
    // Lock icon, tool fallback (the event carries no `tool`) and the exact command.
    await expect(card.locator("svg")).toHaveCount(1);
    await expect(card).toContainText("terminal");
    await expect(card).toContainText("rm -rf /tmp/x");
    await expect(card).toContainText("delete in root path");
    await expect(card.getByRole("button", { name: "Aprobar" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Denegar" })).toBeVisible();

    await card.getByRole("button", { name: "Aprobar" }).click();
    await expect
      .poll(() => harness.approvals.length, { timeout: 10_000 })
      .toBe(1);
    // D2: `requestId` carries the `prompt_id`, generation is copied verbatim.
    expect(harness.approvals[0]?.body).toBe(
      '{"requestId":"p-1","executionGeneration":1,"choice":"once"}',
    );
    await expect(card).toContainText("Aprobado");

    await pushEvent(page, RUN_1, {
      event: "run.completed",
      output: "Listo, comando aprobado y ejecutado.",
      usage: {},
      completed: true,
      partial: false,
      interrupted: false,
    });
    await closeStream(page, RUN_1);
    await expect(page.getByText("Listo, comando aprobado y ejecutado.")).toBeVisible();
  });

  test("denies the approval with choice deny (S8)", async ({ page }) => {
    const harness = newHarness();
    await installRuns(page, harness);
    await installControllableEvents(page);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "borrá /tmp/x");
    await expect(page.getByTestId("hermes-elapsed")).toBeVisible();

    await pushEvent(page, RUN_1, {
      event: "approval.request",
      kind: "approval",
      prompt_id: "p-1",
      execution_generation: 1,
      command: "rm -rf /tmp/x",
      description: "delete in root path",
      choices: ["once", "deny", "session", "always"],
    });

    const card = page.getByTestId("hermes-approval");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Denegar" }).click();
    await expect
      .poll(() => harness.approvals.length, { timeout: 10_000 })
      .toBe(1);
    expect(harness.approvals[0]?.body).toBe(
      '{"requestId":"p-1","executionGeneration":1,"choice":"deny"}',
    );
    await expect(card).toContainText("Denegado");

    await pushEvent(page, RUN_1, {
      event: "run.completed",
      output: "Entendido, no ejecuto nada.",
      usage: {},
      completed: true,
      partial: false,
      interrupted: false,
    });
    await closeStream(page, RUN_1);
    await expect(page.getByText("Entendido, no ejecuto nada.")).toBeVisible();
  });

  test("queues a second message while a run is active (S12)", async ({ page }) => {
    const harness = newHarness();
    harness.eventsBodies.set(RUN_1, () =>
      // Hold run 1 open until the second user bubble exists: only then the
      // queue state is observable, and only then may run 1 settle.
      page
        .waitForFunction(() => (window as unknown as { __e2eReleaseRun1?: boolean }).__e2eReleaseRun1 === true, undefined, {
          timeout: 20_000,
        })
        .then(
          () =>
            dataFrame({ event: "message.delta", delta: "Respuesta uno." }) +
            commentFrame("keepalive") +
            dataFrame({
              event: "run.completed",
              output: "Respuesta uno.",
              usage: {},
              completed: true,
              partial: false,
              interrupted: false,
            }),
        ),
    );
    harness.eventsBodies.set(
      RUN_2,
      dataFrame({
        event: "run.completed",
        output: "Respuesta dos.",
        usage: {},
        completed: true,
        partial: false,
        interrupted: false,
      }),
    );
    await installRuns(page, harness);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "primer mensaje");
    await expect(page.getByTestId("hermes-elapsed")).toBeVisible();

    await sendMessage(page, "segundo mensaje");
    const queued = page.locator('[data-role="user"][data-queued="true"]');
    await expect(queued).toHaveCount(1);
    await expect(queued).toContainText("segundo mensaje");
    await expect(page.getByText("En cola ⏳")).toBeVisible();
    // The second turn waits: no second run starts while run 1 streams.
    expect(harness.creates).toHaveLength(1);

    // Run 1 is still parked on purpose; only now may it settle.
    await page.evaluate(() => {
      (window as unknown as { __e2eReleaseRun1?: boolean }).__e2eReleaseRun1 = true;
    });

    // Run 1 settles → the queued turn fires as the next run of the session.
    await expect
      .poll(() => harness.creates.length, { timeout: 15_000 })
      .toBe(2);
    expect(harness.creates[1]?.message).toBe("segundo mensaje");
    await expect(page.getByText("En cola ⏳")).toHaveCount(0);
    await expect(page.getByText("Respuesta uno.")).toBeVisible();
    await expect(page.getByText("Respuesta dos.")).toBeVisible();
  });

  test("survives a refresh by re-subscribing to the stored run (S5)", async ({ page }) => {
    const harness = newHarness();
    const startedAt = Date.now() - 65_000;
    harness.statusOf = (runId: string) => ({
      runId,
      status: "running",
      sessionId: SESSION_ID,
      createdAt: startedAt,
      executionGeneration: 0,
      output: "",
      usage: {},
      completed: false,
      partial: false,
      interrupted: false,
      error: null,
      pendingControls: null,
    });
    harness.eventsBodies.set(RUN_1, () =>
      // Held briefly: the clock must be observable before the run settles,
      // otherwise the re-subscription is invisible to the assertions.
      new Promise<string>((resolve) => {
        setTimeout(
          () =>
            resolve(
              dataFrame({ event: "message.delta", delta: "todavía trabajando tras el refresh" }) +
                dataFrame({
                  event: "run.completed",
                  output: "todavía trabajando tras el refresh",
                  usage: {},
                  completed: true,
                  partial: false,
                  interrupted: false,
                }),
            ),
          1_500,
        );
      }),
    );
    await installRuns(page, harness);
    await page.addInitScript(
      ([sid, runId, started]: [string, string, number]) => {
        localStorage.setItem("hermes_session_id", sid);
        localStorage.setItem(
          "pd-hermes-run",
          JSON.stringify({ sessionId: sid, runId, startedAt: started }),
        );
      },
      [SESSION_ID, RUN_1, startedAt] as [string, string, number],
    );

    await page.goto("/dashboard/hermes/");
    // No message is sent: the clock comes from the stored run alone.
    const clock = page.getByTestId("hermes-elapsed");
    await expect(clock).toBeVisible({ timeout: 10_000 });
    await expect(clock).toContainText(/\d{2}:\d{2}/);
    await expect(page.getByText("todavía trabajando tras el refresh")).toBeVisible();
    expect(harness.eventsHits.length).toBeGreaterThanOrEqual(1);
    expect(harness.eventsHits[0]).toContain(RUN_1);
  });

  test("keeps the live clock after the first delta (S6)", async ({ page }) => {
    const harness = newHarness();
    await installRuns(page, harness);
    await installControllableEvents(page);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "contame algo largo");

    await pushEvent(page, RUN_1, { event: "message.delta", delta: "primera parte" });
    await expect(page.getByText("primera parte")).toBeVisible();
    // The old transport stopped the timer on the first chunk; the Runs clock
    // spans the whole run (create → terminal).
    await expect(page.getByTestId("hermes-elapsed")).toBeVisible();
    await expect(page.getByTestId("hermes-elapsed")).toContainText("⏱️");

    await pushEvent(page, RUN_1, {
      event: "run.completed",
      output: "primera parte y final",
      usage: {},
      completed: true,
      partial: false,
      interrupted: false,
    });
    await closeStream(page, RUN_1);
    await expect(page.getByText("primera parte y final")).toBeVisible();
    await expect(page.getByTestId("hermes-elapsed")).toHaveCount(0);
  });
});
