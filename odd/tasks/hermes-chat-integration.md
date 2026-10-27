# Hermes chat integration — backend proxy + UI

Branch: `main` (sin commits: regla del spec) · Delivery: cambios en working tree · Runner: `vitest` (frontend), `cargo test` (backend), Node + `@playwright/test` (visual).

## Specs

- **S1** Proxy `POST /api/hermes` en el backend Rust, autenticado con la sesión/API token del usuario, que adjunta `Authorization: Bearer ${HERMES_API_KEY}` y reenvía a `HERMES_API_URL` el body `{messages:[...]}`.
- **S2** El proxy propaga **sin alteraciones** la cabecera `X-Hermes-Session-Id` recibida desde la UI.
- **S3** Timeout del proxy ≥ 180 s (`HERMES_TIMEOUT`, por defecto 180000 ms) y fuera del presupuesto global de 15 s de `/api`. Timeout → 504; credenciales upstream inválidas → 401; upstream caído → 502; sin configurar → 503.
- **S4** Variables en `.env` raíz (gitignored): `HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_TIMEOUT`. La clave nunca llega al navegador, ni a logs, ni a la consola.
- **S5** Sidebar: opción **Hermes** en PLATAFORMA exactamente debajo de **Hábitos**, con el SVG de casco/alas provisto.
- **S6** Módulo de chat en `/dashboard/hermes/`: burbujas (usuario derecha, Hermes izquierda), textarea + **Enviar**, y **"➕ Nueva conversación"** que genera UUID v4, limpia la pantalla y guarda `hermes_session_id`.
- **S7** Al cargar se recupera o genera el UUID en `localStorage` (`hermes_session_id`) y se envía en cada POST. **No** se envía historial: solo `messages:[{role:"user",content:"..."}]`.
- **S8** Markdown seguro y sanitizado en respuestas (`choices[0].message.content`): negritas, viñetas, bloques de código y saltos de línea.
- **S9** Estado "Hermes está trabajando..." visible mientras espera; error dentro de la conversación con **Reintentar**.
- **S10** Validación visual desktop/móvil (icono alineado, diseño del chat, sin overflow) + Judgment Day final. Responsive y accesible (log `aria-live`, labels, Enter envía / Shift+Enter salto).

### Desviaciones registradas (asumidas, no autorizan otra cosa)

- El spec pide Astro `src/pages/api/hermes.ts`; el repo es Next.js **static export** + Rust Axum. Un static export no ejecuta API routes: el proxy equivalente vive en `POST /api/hermes` del backend Rust. La UI consume la misma ruta.
- El spec pide `/hermes`; el chat vive en `/dashboard/hermes/` para conservar AppShell, guard de sesión y convención de rutas del dashboard. El sidebar enlaza ahí.
- `playwright-cli` no está instalado; se usa el arnés Node + `@playwright/test` ya empleado en el repo.
- `.env` raíz: el dueño cargó los valores reales durante la sesión; el archivo está gitignored y nunca se copió a artefactos de revisión. En producción hay que replicarlos en Dokploy.
- La barra móvil conserva sus **5 destinos** de diseño (Hermes es destino del rail de escritorio; el chat sigue siendo responsive y accesible por URL directa). Meter un sexto tab a 390 px pegaba los labels (hallazgo MAJOR de JD).

## Tasks

| ID | Specs | Route | Estado |
|----|-------|-------|--------|
| T1 | S1-S4 | inline | ✅ 481 tests backend |
| T2 | S6-S8 | inline | ✅ 11 tests chat |
| T3 | S5 | inline | ✅ rail + test de orden |
| T4 | S6-S9 | inline | ✅ página + guard |
| T5 | S10 | inline | ✅ JD sin findings |

## Log

**L1** (spec del dueño, verbatim resumido): integrar módulo chat Hermes con proxy backend que adjunta `Authorization: Bearer ${HERMES_API_KEY}`, propaga `X-Hermes-Session-Id`, timeout ≥180 s, UI de chat en sidebar bajo Hábitos con SVG dado, UUID en `hermes_session_id`, markdown sanitizado, estados de carga/error, sin exponer la clave, y Judgment Day. Prohibido commit/push; DB de producción; validación visual obligatoria.

**L2** Exploración: `api_routes()` monta todo bajo un `TimeoutLayer` de 15 s en `assemble` (SEC-003); `/api/hermes` se registra a nivel del router raíz para quedar fuera de ese presupuesto. `Config` sólo lee DATABASE_URL/PORT/SESSION_TTL_HOURS/STATIC_DIR; `AppState` no tiene cliente HTTP. No hay `reqwest` ni librería de markdown instaladas. El sidebar hoy tiene 4 destinos PLATAFORMA + Ajustes en SISTEMA y 5 tabs móviles.

**L3** Implementación: `reqwest` (rustls) para el proxy; `/api/hermes` se registra en el router raíz, fuera del `TimeoutLayer` de 15 s (probado con una respuesta real de 16,5 s en la validación visual). Auth con el middleware existente (sesión o API token). Cuerpo validado a exactamente un turno `user` ≤32 KB; el upstream sólo recibe `{messages:[...]}`. 401 upstream → 401 `HERMES_UNAUTHORIZED`; timeout → 504 `HERMES_TIMEOUT`; caído/5xx → 502; sin configurar → 503. La clave nunca sale del backend.

**L4** UI: `react-markdown` + `remark-gfm` + `rehype-sanitize` (sin `rehype-raw`, HTML crudo jamás se ejecuta). UUID v4 con fallback `getRandomValues` para contextos no seguros (LAN por HTTP). Toolbar "➕ Nueva conversación", indicador de trabajo, error inline con Reintentar. Hermes entra al rail justo debajo de Hábitos y también a la barra móvil (6 destinos: 6×56 px caben en 390 px).

**L5** Evidencia: `tsc` limpio; frontend 58 archivos / 732 tests; backend 481 tests; build static export OK; Playwright real con upstream fake: **37 PASS / 0 FAIL** (`/tmp/opencode/hermes-visual.log`), incluyendo markdown (negrita/viñetas/código), alineación de burbujas, contrato del proxy (sesión propagada, sin historial, sin clave), error+retry, uuid nuevo, persistencia tras reload, respuesta de 16,5 s y móvil 390 px sin overflow. La clave tampoco aparece en el bundle estático.

**L6** Nota operativa: `.env` raíz creado con placeholders válidos (`127.0.0.1`, `CHANGE_ME`); los valores reales deben configurarse en Dokploy (`HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_TIMEOUT`) porque el deploy no lee el `.env` local.

**L7** Judgment Day ronda 1 y correcciones:
- Juez B (MAJOR): el sexto tab móvil pegaba los labels (4 px). Corregido: la barra vuelve a 5 destinos; harness mide separación (5,44 px, baseline del diseño) y ausencia de Hermes en móvil.
- Juez B (MINOR): saltos de línea simples colapsaban → `remark-breaks` + test de `<br>`; foco perdido al reintentar → el foco vuelve al composer + test.
- Juez A (MINOR): timeout al leer el body mapeaba 502 → ahora 504 con test de socket que envía headers y se cuelga; test del presupuesto de 15 s era tautológico → reemplazado por una ruta lenta montada en el nivel externo (150 ms con budget de 20 ms → 200); 422 por mensaje >32 KB mapea a `too_long` sin bucle de reintento; 401 de sesión vs 401 de credenciales Hermes se distinguen (redirect a login); `Debug` de la config redacta la clave.
- Endurecido: imágenes remotas deshabilitadas en Markdown (tracking), `min-h` del chat para viewports cortos (landscape 844×390 validado), escaneo de la clave real (no solo la fake) en bundle/DOM/red.
- Evidencia final: backend 482 tests, frontend 58 archivos / 736 tests, visual **45/45**, y una llamada real a `HERMES_API_URL` desde el proxy con **HTTP 200 y contenido** (sin imprimir la clave).

**L8** Cierre: JD ronda 1 (2 jueces ciegos) → 1 MAJOR + 7 MINOR corregidos; rechecks de ambos jueces: **0 findings**. `tsc` limpio; backend 482 tests; frontend 736; visual 45/45; llamada real a Hermes 200. Sin commit ni push (regla del spec). Usuarios demo eliminados, backend/fake apagados. `.env` con valores reales permanece gitignored y fuera de todo artefacto.
