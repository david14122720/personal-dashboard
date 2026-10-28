import { test, expect, type Route } from "@playwright/test";

/**
 * Hermes streaming UI (ODD `hermes-streaming-pensamiento-cuestionarios`, S2–S7).
 *
 * The proxy's SSE contract is stubbed at the network boundary: the spec drives
 * the real timer, the thought accordion and the interactive question card
 * without a live Hermes server.
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-streaming
 */
const live = process.env.E2E_HERMES_LIVE === "1";

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function stream(frames: string[]): string {
  return frames.join("");
}

const QUESTION = [
  "Listo, amigo 👍 Acá va:",
  "",
  "¿Cómo querés que maneje las notificaciones de los cron jobs?",
  "",
  "1. Solo Telegram — aviso al terminar cada job",
  "2. Telegram + resumen semanal — en el chat de Hermes",
  "3. Silencioso — corren sin avisar; solo me consultás si algo falla",
  "",
  "Respondé con el número y lo dejamos así.",
].join("\n");

async function sse(route: Route, body: string, delayMs = 0) {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    body,
  });
}

test.describe("Hermes streaming", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("dashboard-token", "e2e-stub");
      localStorage.setItem("hermes-session-id", "7f3c1d2e-1111-4aaa-9bbb-00000000e2ee");
    });
  });

  test("counts the wait in MM:SS and collapses the reasoning by default", async ({ page }) => {
    await page.route("**/api/hermes", (route) =>
      sse(
        route,
        stream([
          frame("start", { timeoutMs: 600_000 }),
          frame("thinking", { text: "El usuario pide un trabajo largo. " }),
          frame("thinking", { text: "Voy a mirar el disco." }),
          frame("tool", {
            tool: "terminal",
            emoji: "💻",
            label: "ls -A /opt/data",
            status: "running",
            toolCallId: "c1",
          }),
          frame("delta", { text: "Encontré 41 archivos." }),
          frame("done", { reply: "Encontré 41 archivos.", artifacts: [], warnings: [] }),
        ]),
        1_200,
      ),
    );

    await page.goto("/dashboard/hermes/");
    await page.locator("#hermes-input").fill("hacé un trabajo largo");
    await page.getByRole("button", { name: "Enviar" }).click();

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

  test("turns numbered choices into a card and sends the answer", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/hermes", (route) => {
      calls += 1;
      const reply = calls === 1 ? QUESTION : "Listo, quedó configurado.";
      return sse(
        route,
        stream([
          frame("start", { timeoutMs: 600_000 }),
          frame("delta", { text: reply.slice(0, 20) }),
          frame("done", { reply, artifacts: [], warnings: [] }),
        ]),
      );
    });

    await page.goto("/dashboard/hermes/");
    await page.locator("#hermes-input").fill("configurá las notificaciones");
    await page.getByRole("button", { name: "Enviar" }).click();

    const card = page.getByTestId("hermes-question");
    await expect(card).toBeVisible();
    await expect(card).toContainText("¿Cómo querés que maneje las notificaciones");
    await expect(card.getByRole("button")).toHaveCount(5); // 3 options + Otra cosa + Omitir
    const markdown = page.getByTestId("hermes-markdown").first();
    await expect(markdown).not.toContainText("Solo Telegram");
    await expect(markdown).not.toContainText("Respondé con el número");

    await card.getByText("Telegram + resumen semanal").click();
    await expect(card).toContainText("Respondido: Telegram + resumen semanal");
    await expect(page.locator('[data-role="user"]').last()).toContainText(
      "Telegram + resumen semanal",
    );
    await expect(page.getByText("Listo, quedó configurado.")).toBeVisible();
  });

  test("keeps one scroll container and no inner scrollbars", async ({ page }) => {
    const long = Array.from({ length: 40 }, (_, index) => `Línea ${index + 1} de la respuesta.`).join("\n");
    await page.route("**/api/hermes", (route) =>
      sse(
        route,
        stream([
          frame("start", { timeoutMs: 600_000 }),
          frame("done", { reply: long, artifacts: [], warnings: [] }),
        ]),
      ),
    );

    await page.goto("/dashboard/hermes/");
    await page.locator("#hermes-input").fill("dame una respuesta larga");
    await page.getByRole("button", { name: "Enviar" }).click();
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
});
