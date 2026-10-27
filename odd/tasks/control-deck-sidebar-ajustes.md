# Sidebar colapsable + unificación de Ajustes (Control Deck)

Branch: `main` (sin commits por instrucción del dueño) · Runner: `npx vitest run` · Delivery: sin commit/push (regla del spec).

## Specs

- **S1** Botón de colapso/expansión en el encabezado del sidebar, junto al logo. El sidebar pasa de `w-64` a un rail compacto de ~72px con transición. Por defecto: expandido; `aria-expanded` y `aria-controls` correctos.
- **S2** En estado colapsado se ocultan: headers "PLATAFORMA"/"SISTEMA", textos de los enlaces ("Dashboard", "Finanzas", "Productividad", "Hábitos", "Ajustes"), badge de versión `v0.1.0`, bajada "Centro de Mando" y los datos textuales del perfil ("David Alejandro", correo). Quedan visibles solo los iconos y el avatar, centrados horizontalmente.
- **S3** Hover sobre un icono en modo colapsado despliega un tooltip flotante con el nombre de la sección/acción; también visible con foco de teclado (`:focus-visible`), y el enlace conserva nombre accesible (`aria-label`).
- **S4** La preferencia `collapsed` se guarda en `localStorage` y se restaura al recargar/navegar (sin mismatch de hidratación: primer render expandido, estado aplicado tras montar).
- **S5** SISTEMA deja un único enlace: "Ajustes". Se eliminan del sidebar "Tokens de API" y "Sesiones". La barra móvil de 5 destinos no cambia.
- **S6** `/dashboard/ajustes/` se reestructura como interfaz única con pestañas: **General** (cuentas, suscripciones, categorías), **Tokens de API** (listar, generar, copiar, revocar) y **Sesiones** (listar activas, cerrar las demás). Sin pérdida de funcionalidad.
- **S7** Las rutas previas `/dashboard/ajustes/tokens/` y `/dashboard/ajustes/sesiones/` siguen funcionando y renderizan la misma interfaz unificada con la pestaña correspondiente activa (deep links y enlaces viejos no se rompen).
- **S8** Responsive: sidebar solo en escritorio (`md+`), móvil conserva chrome actual; validación visual con Playwright de expandido/colapsado y de Ajustes en escritorio y móvil.
- **S9** Judgment Day con dos jueces ciegos concluye sin blockers.
- **S10** Todo el copy nuevo en español, claves en `frontend/lib/i18n/es.ts`.

## Tasks

| ID | Specs | Ruta | Estado |
|----|-------|------|--------|
| T1 | S1–S4, S10 | inline | ✅ 24/24 shell tests |
| T2 | S5 | inline | ✅ rail de 5, SISTEMA solo Ajustes |
| T3 | S6, S7 | inline | ✅ 21/21 ajustes tests, deep links |
| T4 | S8 | inline | ✅ 54/54 Playwright (DB producción) |
| T5 | S9 | inline | ✅ JD sin findings |

## Log

**L1** (pedido del dueño, verbatim):

> bien amigo hoy vamos hacer otro cambio importante : # ODD Spec: Sidebar Colapsable y Unificación del Panel de Ajustes (Control Deck)
>
> ## 1. Reglas Estrictas de Entorno (Globales)
> - **Metodología:** Organic-Driven Development (ODD).
> - **Base de Datos:** Mantén la conexión y uso exclusivo de la base de datos de PRODUCCIÓN. Queda estrictamente prohibido crear o migrar bases de datos locales.
> - **Control de Versiones:** Queda estrictamente PROHIBIDO ejecutar `git commit` o `git push`.
> - **Validación Visual:** Usa la skill `playwright-cli` para verificar el estado expandido y colapsado del sidebar, así como la nueva interfaz unificada de Ajustes en versión escritorio y móvil.
> - **Validación de Integridad:** Ejecuta obligatoriamente tu proceso de verificación interno ("Judgment Day" / verify) al finalizar.
>
> ## 2. Rediseño del Sidebar (Modo Colapsable / Icon-Only Rail)
> […]
>
> ## 4. Criterios de Aceptación
> 1. El sidebar se colapsa y expande a voluntad mediante el botón toggle, mostrando solo la columna de iconos en estado colapsado.
> 2. Cada icono en modo colapsado muestra su tooltip descriptivo al hacer hover.
> 3. La preferencia de sidebar (colapsado/expandido) persiste tras refrescar la página mediante `localStorage`.
> 4. El menú "SISTEMA" únicamente contiene el acceso a "Ajustes".
> 5. La vista de "Ajustes" integra en una sola interfaz con pestañas la configuración general, la gestión de Tokens de API y el control de Sesiones activas, sin haber perdido ninguna funcionalidad previa.
> 6. La interfaz es completamente responsiva y validada visualmente con Playwright.
> 7. El proceso de verificación ("Judgment Day") concluye con éxito garantizando que las rutas y componentes redirigidos funcionan sin regresiones.

**L2** Hallazgos de exploración:
- El sidebar vive en `frontend/components/layout/AppShell.tsx` (`RailNav`, `RailLink`, `SessionCard`, `SETTINGS_NAV`).
- Tokens y Sesiones ya son componentes de página autocontenidos; se extraen a paneles sin tocar su lógica de API.
- `isActive` trata `/dashboard/ajustes` como página exacta; con la unificación debe marcar Ajustes también en sus pestañas.
- No existe `playwright-cli` en el entorno (verificado en features previas): se usa el mismo patrón Node + `@playwright/test` con servidor estático en :8052 y usuario desechable de producción.

**L3** Implementación:
- `AppShell`: `useCollapsedSidebar` (localStorage `pd-sidebar-collapsed`), rail 72px con transición, textos/grupos/versión/bajada/perfil ocultos, tooltips CSS `group-hover`/`group-focus-visible`, avatar+logout centrados, `aria-expanded`/`aria-controls`.
- `SETTINGS_NAV` reducido a Ajustes; `isActive` ahora marca el hub también en sus pestañas (breadcrumb y rail).
- Hub unificado: `SettingsScreen` + `SettingsTabs` + paneles `GeneralSettings`, `ApiTokensPanel`, `SessionsPanel`; las tres rutas (`/ajustes/`, `/ajustes/tokens/`, `/ajustes/sesiones/`) renderizan la misma interfaz con su pestaña activa.
- Copy en `es.ts`: `nav.collapseSidebar/expandSidebar`, `settings.tabsLabel/tabGeneral/tabSessions`, subtítulo del hub.

**L4** Verificación:
- `npx tsc --noEmit` limpio; suite 57 archivos / 721 tests.
- Playwright contra backend real + DB producción: **54/54** (anchos 256→72, tooltip, persistencia tras reload y navegación SPA, SISTEMA sin Tokens/Sesiones, tres pestañas, crear/copiar/revocar token, sesión actual, deep links, móvil 390 sin overflow ni wrap de pestañas).
- Dos corridas intermedias fallaron por `PoolTimedOut` transitorio de la DB de producción (500s en consola), no por el cambio; se reintentó hasta obtener log limpio.

**L5** Judgment Day (2 jueces ciegos, freeze aislado):
- Ronda 1 — Juez B: 1 MINOR real (el toggle se montaba sobre el badge de versión) + 2 INFO de evidencia (check de copiado tautológico, captura con secreto legible). Corregido: handle flotante fuera del flujo del header en ambos estados, clipboard verificado contra el secreto real, captura difuminada. Recheck: 0 findings.
- Ronda 1 — Juez A: captura vacía dos veces; tercer intento: 2 MINOR de hit-target (toggle 24px, logout 28px, pestañas 40px) + 1 INFO (el `title` del avatar exponía el nombre). Corregido a 44px los tres controles y título eliminado. Recheck: 0 findings.
- Freeze final: `491b52c667d1eb6c`.

**L6** Cierre: `tsc` limpio, 57 archivos / 721 tests, Playwright real **60/60**. Sin commit ni push (regla del spec). Usuario desechable y backend de validación eliminados.
