import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes multimodal composer (ODD `hermes-entrada-multimodal`, S3/S4/S5/S7).
 *
 * `/api/uploads` is NOT stubbed: every attachment is stored by the real Rust
 * route (which sniffs the bytes and answers the S4 receipt) and read back
 * through the session-authenticated `GET /api/uploads/{id}`, so a regression of
 * the upload contract, of the per-file state or of the blob read-back fails
 * here. Only the Runs transport is stubbed at the network boundary, with the
 * same shape the other Hermes specs use: `POST /api/hermes/runs` answers `202`,
 * the events endpoint answers verbatim gateway frames (`id:` + `data:`, no
 * `event:` line) and `GET /api/hermes/runs/{id}` answers a finished run.
 *
 * Covered: `Shift+Enter` vs `Enter`, multi-file clip, per-chip `✕`, an empty
 * message with attachments, drag & drop, `Ctrl+V` paste, the per-file status
 * bar reaching `listo`, and the S5 bubble (image from the authenticated
 * read-back plus a document card), with screenshots for review.
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 E2E_USER=... \
 *     E2E_PASSWORD=... npx playwright test hermes-composer
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const SESSION_ID = "7f3c1d2e-3333-4aaa-9bbb-00000000e2e1";
const RUN_1 = "run_e2e_composer_1";

/**
 * A real, visible PNG (96×64, two-tone): the backend sniffs these bytes as
 * `image/png` and the bubble screenshot shows an actual picture rather than a
 * transparent 1×1 pixel.
 */
const PNG_BYTES = Buffer.from(
  [
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAAoklEQVR42u3bsQkAIAwEQCdwHhd2DAdyAzsdIhARr0j98Fc+",
    "KW2sHbnaZ+h+zy8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAoAC7+YDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAKtIgB",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AQq0iAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgOfzDwfcV98cG/g7AAAAAElFTkSu",
    "QmCC",
  ].join(""),
  "base64",
);

/** A real PDF header: the backend sniffs `%PDF` and answers `application/pdf`. */
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

let frameId = 0;

/** One SSE frame in the gateway's shape (`id:` + `data:`, no `event:` line). */
function frame(payload: Record<string, unknown>): string {
  frameId += 1;
  return `id: ${frameId}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function completed(output: string): string {
  return frame({
    event: "run.completed",
    output,
    usage: {},
    completed: true,
    partial: false,
    interrupted: false,
  });
}

/** One `POST /api/hermes/runs` the UI made, exactly as it went on the wire. */
interface RunPost {
  multipart: boolean;
  /** The JSON turn text; empty for a multipart body (see `body`). */
  message: string;
  /** Raw body as latin1, so a multipart part can be inspected verbatim. */
  body: string;
}

interface RunsStub {
  posts: RunPost[];
}

/**
 * Stub the Runs API. `body` may be a promise factory so a test can hold the
 * event stream open and observe the composer mid-flight.
 */
async function installRuns(
  page: Page,
  body: string | (() => Promise<string>),
): Promise<RunsStub> {
  const stub: RunsStub = { posts: [] };
  await page.route("**/api/hermes/runs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/events")) {
      const payload = typeof body === "function" ? await body() : body;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: payload,
      });
      return;
    }
    if (request.method() === "POST" && /\/api\/hermes\/runs\/?$/.test(url.pathname)) {
      const raw = request.postDataBuffer() ?? Buffer.alloc(0);
      const multipart = (request.headers()["content-type"] ?? "").startsWith(
        "multipart/form-data",
      );
      let message = "";
      if (!multipart) {
        try {
          message = String(
            (JSON.parse(raw.toString("utf8")) as { message?: unknown }).message ?? "",
          );
        } catch {
          message = "";
        }
      }
      stub.posts.push({ multipart, message, body: raw.toString("latin1") });
      await route.fulfill({
        status: 202,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: RUN_1, sessionId: SESSION_ID, createdAt: Date.now() }),
      });
      return;
    }
    if (request.method() === "GET") {
      const runId = url.pathname.split("/").pop() ?? RUN_1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          status: "completed",
          sessionId: SESSION_ID,
          createdAt: Date.now(),
          executionGeneration: 0,
          output: "",
          usage: {},
          completed: true,
          partial: false,
          interrupted: false,
          error: null,
          pendingControls: null,
        }),
      });
      return;
    }
    await route.fallback();
  });
  return stub;
}

async function openChat(page: Page): Promise<void> {
  await page.addInitScript((sid: string) => {
    localStorage.setItem("hermes_session_id", sid);
  }, SESSION_ID);
  await loginViaApi(page);
  await page.goto("/dashboard/hermes/");
  await expect(page.locator("#hermes-input")).toBeVisible();
}

const composer = (page: Page) => page.locator("#hermes-input");
const chips = (page: Page) => page.locator('[data-testid="attachment-chip"]');
const sendButton = (page: Page) => page.getByRole("button", { name: "Enviar" });

interface ClipFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** The clip's file picker accepts several files in one dialog (S3). */
async function attachViaClip(page: Page, files: ClipFile[]): Promise<void> {
  await page.locator('[data-testid="hermes-file-input"]').setInputFiles(files);
}

test.describe("Hermes multimodal composer", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(() => {
    frameId = 0;
  });

  test("Enter sends the two-line text and Shift+Enter only breaks the line", async ({ page }) => {
    const runs = await installRuns(page, completed("Recibido."));
    await openChat(page);
    await expect(sendButton(page)).toBeDisabled();

    await composer(page).click();
    await page.keyboard.type("primera línea");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("segunda línea");

    // S3: Shift+Enter is a newline inside the box, never a send.
    await expect(composer(page)).toHaveValue("primera línea\nsegunda línea");
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(runs.posts).toHaveLength(0);

    // A bare Enter submits the multi-line text as one turn.
    await page.keyboard.press("Enter");
    await expect.poll(() => runs.posts.length).toBe(1);
    expect(runs.posts[0].multipart).toBe(false);
    expect(runs.posts[0].message).toBe("primera línea\nsegunda línea");
    await expect(page.locator('[data-role="user"]').last()).toContainText("segunda línea");
  });

  test("the clip attaches two files, ✕ removes exactly one and empty text still sends", async ({
    page,
  }) => {
    const runs = await installRuns(page, completed("Listo."));
    await openChat(page);
    await expect(sendButton(page)).toBeDisabled();

    await attachViaClip(page, [
      { name: "pixel.png", mimeType: "image/png", buffer: PNG_BYTES },
      { name: "informe.pdf", mimeType: "application/pdf", buffer: PDF_BYTES },
    ]);

    // Two chips, each with its name and its weight in bytes.
    await expect(chips(page)).toHaveCount(2);
    const pngChip = chips(page).filter({ hasText: "pixel.png" });
    const pdfChip = chips(page).filter({ hasText: "informe.pdf" });
    await expect(pngChip).toContainText(`${PNG_BYTES.length} B`);
    await expect(pdfChip).toContainText(`${PDF_BYTES.length} B`);

    // ✕ removes only the chip it belongs to.
    await page.getByRole("button", { name: "Quitar informe.pdf" }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("pixel.png");

    // S3: an empty message with an attachment keeps "Enviar" active.
    await expect(composer(page)).toHaveValue("");
    await expect(sendButton(page)).toBeEnabled();
    await sendButton(page).click();

    await expect.poll(() => runs.posts.length).toBe(1);
    // The image is the only attachment left, so it is the only file on the wire.
    expect(runs.posts[0].multipart).toBe(true);
    expect(runs.posts[0].body).toContain('filename="pixel.png"');
    expect(runs.posts[0].body).not.toContain("informe.pdf");
  });

  test("shows a per-file status bar that reaches listo before the reply lands", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs = await installRuns(page, async () => {
      await gate;
      return completed("Listo.");
    });
    await openChat(page);

    await attachViaClip(page, [
      { name: "estado.png", mimeType: "image/png", buffer: PNG_BYTES },
    ]);
    await expect(chips(page)).toHaveCount(1);
    await sendButton(page).click();

    // S3/D-B4: the chip reports its real state, not a fake percentage.
    const bar = page.getByRole("progressbar", { name: "estado.png" });
    await expect(bar).toHaveAttribute("aria-valuetext", "listo");
    await expect(chips(page).first()).toContainText("listo");
    await expect.poll(() => runs.posts.length).toBe(1);

    // The reply was held back on purpose: the chip lived until the run settled.
    release();
    await expect(chips(page)).toHaveCount(0);
  });

  test("pasting a screenshot from the clipboard attaches it", async ({ page }) => {
    await installRuns(page, completed("Recibido."));
    await openChat(page);
    await composer(page).click();

    await page.evaluate((png: number[]) => {
      const box = document.querySelector<HTMLTextAreaElement>("#hermes-input");
      if (!box) throw new Error("composer not found");
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(png)], "captura.png", { type: "image/png" }));
      const event = new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      });
      // Older engines expose the constructor but ignore `clipboardData`.
      if (!event.clipboardData) {
        Object.defineProperty(event, "clipboardData", { value: transfer });
      }
      box.dispatchEvent(event);
    }, Array.from(PNG_BYTES));

    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("captura.png");
    await expect(sendButton(page)).toBeEnabled();
  });

  test("dropping two files at once attaches both", async ({ page }) => {
    await installRuns(page, completed("Recibido."));
    await openChat(page);

    await page.evaluate(
      ({ png, pdf }: { png: number[]; pdf: number[] }) => {
        const zone = document.querySelector<HTMLElement>('[data-testid="hermes-dropzone"]');
        if (!zone) throw new Error("drop zone not found");
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(png)], "soltada.png", { type: "image/png" }));
        transfer.items.add(
          new File([new Uint8Array(pdf)], "soltado.pdf", { type: "application/pdf" }),
        );
        for (const type of ["dragover", "drop"]) {
          zone.dispatchEvent(
            new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
          );
        }
      },
      { png: Array.from(PNG_BYTES), pdf: Array.from(PDF_BYTES) },
    );

    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).filter({ hasText: "soltada.png" })).toHaveCount(1);
    await expect(chips(page).filter({ hasText: "soltado.pdf" })).toHaveCount(1);
  });

  test("paints the sent image from the authenticated read-back and the document as a card", async ({
    page,
  }) => {
    const runs = await installRuns(page, completed("Listo, lo recibí."));
    await openChat(page);

    await attachViaClip(page, [
      { name: "foto.png", mimeType: "image/png", buffer: PNG_BYTES },
      { name: "informe.pdf", mimeType: "application/pdf", buffer: PDF_BYTES },
    ]);
    await expect(chips(page)).toHaveCount(2);
    await page.screenshot({ path: "test-results/hermes-composer-two-chips.png" });

    await composer(page).fill("mirá estos dos");
    await sendButton(page).click();

    const bubble = page.locator('[data-role="user"]').last();
    const picture = bubble.locator("img");
    await expect(picture).toHaveCount(1);
    await expect(picture).toHaveAttribute("alt", "foto.png");
    await expect(picture).toHaveAttribute("src", /^blob:/);
    // S5 + D-B2: the authenticated `GET /api/uploads/{id}` produced real bytes,
    // so the element decoded a picture instead of merely carrying a stub `src`.
    await expect
      .poll(() => picture.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    const card = bubble.locator('[data-testid="user-attachment-card"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("informe.pdf");
    await expect(card).toContainText(`${PDF_BYTES.length} B`);
    await page.screenshot({ path: "test-results/hermes-composer-sent-bubble.png" });

    // S4: the image travels as multipart and the PDF as the structured
    // reference in the turn text (the upload dir is the backend's own).
    await expect.poll(() => runs.posts.length).toBe(1);
    expect(runs.posts[0].multipart).toBe(true);
    expect(runs.posts[0].body).toContain('filename="foto.png"');
    expect(runs.posts[0].body).toMatch(
      /\[archivo adjunto: informe\.pdf \(application\/pdf, \d+ B\), ruta: \/[^\]]*\.pdf\]/,
    );
    expect(runs.posts[0].body).not.toContain("data:application/pdf");

    // The reload is the proof that matters: the chip's local preview is gone,
    // so the image can only come back through the authenticated read-back.
    await page.reload();
    const restored = page.locator('[data-role="user"]').last();
    const restoredPicture = restored.locator("img");
    await expect(restoredPicture).toHaveCount(1);
    await expect(restoredPicture).toHaveAttribute("alt", "foto.png");
    await expect
      .poll(() => restoredPicture.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(restored.locator('[data-testid="user-attachment-card"]')).toContainText(
      "informe.pdf",
    );
  });
});
