import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * S4 productivity layout evidence harness (Track B).
 *
 * Deliberately NOT gated on `E2E_SMOKE_LIVE`: it seeds the bearer token via
 * `page.addInitScript` into `localStorage["dashboard-token"]` (mirroring
 * `loginViaApi` in `./helpers` without the network call) and stubs every
 * productivity read with a page.route API stub serving deterministic fixtures.
 *
 * For each viewport (390x844, 768x768, 1440x900) it measures:
 * - `document.documentElement.scrollWidth <= clientWidth` (no overflow)
 * - `getBoundingClientRect()` of every date/datetime-local/select/input
 * - the `xl` column spans per section row
 * - the hit-area boxes of Editar/Eliminar/Nuevo (+ toggles)
 *
 * Output goes to `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/`
 * using `LAYOUT_EVIDENCE_PHASE=before|after` for filenames:
 * `{width}-{phase}.png` screenshots + `metrics-{phase}.json`.
 */

const PHASE = process.env.LAYOUT_EVIDENCE_PHASE ?? "after";
const EVIDENCE_DIR = path.resolve(
  __dirname,
  "../../openspec/changes/2026-09-23-simplify-finance-productivity/evidence",
);

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 768 },
  { name: "1440", width: 1440, height: 900 },
] as const;

const SECTION_NAMES = ["Metas", "Tareas", "Eventos", "Notas"] as const;

const goalsFixture = [
  {
    id: "g1",
    name: "Correr una maratón",
    description: "Entrenar cada semana",
    area: "health",
    start_date: "2026-09-01",
    due_date: "2026-12-31",
    progress: 50,
    status: "active",
    color: null,
  },
  {
    id: "g2",
    name: "Publicar panel",
    description: null,
    area: "work",
    start_date: "2026-09-01",
    due_date: null,
    progress: 100,
    status: "completed",
    color: null,
  },
];

const tasksFixture = [
  {
    id: "t1",
    title: "Comprar zapatos",
    description: null,
    priority: "high",
    status: "pending",
    due_date: "2026-09-10",
    completed_at: null,
    goal_id: "g1",
    sort_order: 0,
  },
  {
    id: "t2",
    title: "Escribir plan",
    description: null,
    priority: "medium",
    status: "in_progress",
    due_date: null,
    completed_at: null,
    goal_id: null,
    sort_order: 1,
  },
];

const eventsFixture = [
  {
    id: "e1",
    title: "Dentista",
    description: null,
    kind: "appointment",
    starts_at: "2026-09-10T10:00:00Z",
    ends_at: "2026-09-10T11:00:00Z",
    all_day: false,
    location: "Clínica",
  },
  {
    id: "e2",
    title: "Pagar arriendo",
    description: null,
    kind: "payment_due",
    starts_at: "2026-09-12T00:00:00Z",
    ends_at: null,
    all_day: true,
    location: null,
  },
];

const notesFixture = [
  {
    id: "n1",
    title: "Plan del proyecto",
    body: "Hoja de ruta trimestral del panel personal con texto largo para medir desborde",
    is_markdown: true,
    is_pinned: true,
    updated_at: "2026-09-07T10:00:00Z",
  },
  {
    id: "n2",
    title: "Lista de compras",
    body: "Leche y huevos",
    is_markdown: true,
    is_pinned: false,
    updated_at: "2026-09-06T10:00:00Z",
  },
];

const meFixture = {
  email: "e2e@test.local",
  preferences: { currency_code: "COP", locale: "es-CO", dashboard_layout: { widgets: [] } },
};

interface InputMetric {
  section: string;
  tag: string;
  inputType: string;
  width: number;
  formWidth: number;
  fullWidth: boolean;
}

interface ControlMetric {
  section: string;
  name: string;
  width: number;
  height: number;
  passes: boolean;
}

interface ViewportMetric {
  viewport: string;
  width: number;
  height: number;
  scrollWidth: number;
  clientWidth: number;
  noOverflow: boolean;
  xlSpans: Record<string, number | null>;
  xlRowSums: number[];
  inputs: InputMetric[];
  controls: ControlMetric[];
}

test("productivity layout evidence @390/768/1440", async ({ page }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const finish = (body: unknown): Promise<void> =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (route.request().method() !== "GET") {
      await finish({ ok: true });
      return;
    }
    if (url.includes("/api/goals")) {
      await finish(goalsFixture);
    } else if (url.includes("/api/tasks")) {
      await finish(tasksFixture);
    } else if (url.includes("/api/events")) {
      await finish(eventsFixture);
    } else if (url.includes("/api/notes")) {
      await finish(notesFixture);
    } else if (url.includes("/api/me")) {
      await finish(meFixture);
    } else {
      await finish([]);
    }
  });

  const metrics: ViewportMetric[] = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript((token: string) => {
      localStorage.setItem("dashboard-token", token);
    }, "e2e-layout-token");

    await page.goto("/dashboard/productivity/");
    await expect(page.getByRole("heading", { name: "Productividad" })).toBeVisible({
      timeout: 15_000,
    });
    // Lists resolve from the stubbed reads (generous timeout: first dev
    // compile of the page JS can take a while under Turbopack).
    await expect(page.getByRole("region", { name: "Metas" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Comprar zapatos")).toBeVisible({ timeout: 30_000 });

    // Expand one collapsed form at a time (tolerant: pre-WU2 the forms are
    // always mounted and no Nuevo toggle exists yet).
    const viewportInputs: InputMetric[] = [];
    for (const section of SECTION_NAMES) {
      const region = page.getByRole("region", { name: section });
      const nuevo = region.getByRole("button", { name: /Nuevo/ });
      if ((await nuevo.count()) > 0) {
        await nuevo.first().click();
      }
      const sectionInputs: Array<Omit<InputMetric, "section">> = await region.evaluate((el) => {
        const form = el.querySelector("form");
        const scope = form ?? el;
        const formWidth = form?.getBoundingClientRect().width ?? el.getBoundingClientRect().width;
        const nodes = Array.from(
          scope.querySelectorAll(
            'input[type="date"], input[type="datetime-local"], select, input[type="text"], textarea',
          ),
        );
        return nodes.map((node) => {
          const rect = (node as HTMLElement).getBoundingClientRect();
          const inputType =
            node.tagName.toLowerCase() === "select"
              ? "select"
              : ((node as HTMLInputElement).type || node.tagName.toLowerCase());
          return {
            tag: node.tagName.toLowerCase(),
            inputType,
            width: Math.round(rect.width * 10) / 10,
            formWidth: Math.round(formWidth * 10) / 10,
            fullWidth: rect.width >= formWidth - 2,
          };
        });
      });
      for (const input of sectionInputs) {
        viewportInputs.push({ section, ...input });
      }
      if ((await nuevo.count()) > 0) {
        // Collapse again so the next section can open (single-open invariant).
        const expanded = await nuevo.first().getAttribute("aria-expanded");
        if (expanded === "true") {
          await nuevo.first().click();
        }
      }
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    const xlSpans = await page.evaluate((sections: readonly string[]) => {
      const out: Record<string, number | null> = {};
      for (const name of sections) {
        const el = Array.from(document.querySelectorAll("section")).find(
          (s) => s.getAttribute("aria-label") === name,
        );
        const match = el?.className.match(/xl:col-span-(\d+)/);
        out[name] = match ? Number(match[1]) : null;
      }
      return out;
    }, SECTION_NAMES);

    const controls: Array<Omit<ControlMetric, "passes">> = await page.evaluate((sections: readonly string[]) => {
      const out: Array<{ section: string; name: string; width: number; height: number }> = [];
      for (const name of sections) {
        const el = Array.from(document.querySelectorAll("section")).find(
          (s) => s.getAttribute("aria-label") === name,
        );
        if (!el) continue;
        // Skip the search input row; measure real buttons only.
        const buttons = Array.from(el.querySelectorAll("button")).filter((b) =>
          /Editar|Eliminar|Nuevo|Hecho|Reabrir|Fijada|fijada|Cancelar|Guardar|Crear/i.test(
            b.textContent ?? "",
          ),
        );
        for (const button of buttons) {
          if (!(button instanceof HTMLElement) || button.offsetParent === null) continue;
          const rect = button.getBoundingClientRect();
          out.push({
            section: name,
            name: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().slice(0, 60),
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          });
        }
      }
      return out;
    }, SECTION_NAMES);

    const orderedSpans = SECTION_NAMES.map((s) => xlSpans[s] ?? 0);
    const xlRowSums =
      orderedSpans.length === 4
        ? [orderedSpans[0] + orderedSpans[1], orderedSpans[2] + orderedSpans[3]]
        : [];

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${viewport.name}-${PHASE}.png`),
      fullPage: true,
    });

    metrics.push({
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      scrollWidth: overflow.scrollWidth,
      clientWidth: overflow.clientWidth,
      noOverflow: overflow.scrollWidth <= overflow.clientWidth,
      xlSpans,
      xlRowSums,
      inputs: viewportInputs,
      controls: controls.map((c) => ({
        ...c,
        passes: c.width >= 43.5 && c.height >= 43.5,
      })),
    });
  }

  const failures: string[] = [];
  for (const m of metrics) {
    if (!m.noOverflow) {
      failures.push(`${m.viewport}: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`);
    }
    for (const sum of m.xlRowSums) {
      if (sum !== 12) failures.push(`${m.viewport}: xl row sum ${sum} !== 12`);
    }
    if (m.viewport === "390") {
      for (const input of m.inputs) {
        if (input.inputType === "date" || input.inputType === "datetime-local" || input.inputType === "select") {
          if (!input.fullWidth) {
            failures.push(
              `${m.viewport}: ${input.section} ${input.inputType} width ${input.width} < form ${input.formWidth}`,
            );
          }
        }
      }
    }
    for (const control of m.controls) {
      if (!control.passes) {
        failures.push(
          `${m.viewport}: control "${control.name}" ${control.width}x${control.height} < 44x44`,
        );
      }
    }
  }

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, `metrics-${PHASE}.json`),
    JSON.stringify({ phase: PHASE, pass: failures.length === 0, failures, viewports: metrics }, null, 2),
  );

  expect(failures, `layout defects:\n${failures.join("\n")}`).toEqual([]);
});
