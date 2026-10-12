# Feature — ui-polish-responsive

**Goal**: pulir la interfaz de las cinco áreas (Dashboard, Finanzas, Productividad, Configuración, Login) en escritorio y móvil, **sin tocar funcionalidad**, priorizando que la versión móvil deje de verse mal.

**Owner rules (2026-10-04)**: sin commit, sin push, sin deploy; sin dependencias nuevas; base de datos de producción para cualquier verificación con datos; todo se revisa en local.

**SDD**: `openspec/changes/2026-10-04-ui-polish-responsive/` (`explore.md`, `proposal.md`, `design.md`, `tasks.md` + deltas `frontend-visual-system`, `frontend-dashboard`, `productivity-layout`).

## Estado

| Unidad | Alcance | Estado | Evidencia |
|---|---|---|---|
| P0 | Artefactos SDD | hecho | 4 documentos + 3 deltas |
| P1 | Tokens y superficies canónicas (`globals.css`) | hecho | `--color-panel`, `--color-panel-soft`; 16 hex crudos → tokens |
| P2 | Shell y navegación móvil (`AppShell`) | hecho | barra 534 → 375/375 sin desborde, 7 destinos, 2 filas |
| P3 | Dashboard | hecho | tarjetas canónicas, CTA 44px, toggle 36px, fade-in en disclosures |
| P4 | Finanzas (gráficas, modales, formularios) | hecho | gráficas 560 → contenedor; modales topados 608/640 + scroll lock; 3 grids apilados |
| R2 | Ronda 2 tras el Día del Juicio: filas apiladas y texto largo en 2 líneas | hecho | Dashboard 20 → 4 truncados, Finanzas 15 → 1, Ajustes 2 → 0, Productividad 11 → 1 (sr-only) |
| P5 | Productividad (calendario, chips) | hecho | calendario 312/309 → 309/309; pestañas 26 → 44px; vacío con EmptyState |
| P6 | Configuración (tarjetas, vacíos, controles) | hecho | tarjetas, 5 vacíos reales (copy ya existía), `col-span-2` → `sm:col-span-2` |
| P7 | Login | hecho | ojo 26 → 44px, fila recordar 44px, campos canónicos |
| P8 | Verificación + Día del Juicio | hecho | 568/568, tsc 0, 0 desborde, 0 errores de consola, regresión 16/16 + UI 7/7, 2 jueces (B re-juzgó y aprobó) |

## Bloqueo operativo

La base de producción `192.168.50.120:5434` rechaza conexiones desde 2026-10-04 01:20 UTC (el host responde ICMP, el puerto no). Decisión del dueño: seguir con el trabajo de código y verificar en vivo cuando el puerto vuelva a responder. **No** se levantó un Postgres local.

## Decisiones

1. La barra inferior móvil conserva **los siete destinos** (dos filas de cuatro y tres) porque la alternativa de cinco ítems dejaría `/dashboard/ajustes/tokens/` inalcanzable en móvil (el hub de Ajustes sólo enlaza sesiones) → sería un cambio funcional.
2. Sin nuevas abstracciones: las cadenas canónicas se aplican en el lugar; `design.md` es la única fuente de verdad.
3. Sin rediseño: se conserva el lenguaje Control Deck (paleta, tipografías, radios, keyframes).
4. i18n: sin claves nuevas — la copy de los estados vacíos ya existía y no se cambió ninguna.
5. Única edición de test prevista: la celda del calendario pasa de `min-w-[44px]` a `min-w-0` (necesario para entrar en 375px, conservando `min-h-[44px]`).

## Guardarraíles (no romper)

Las listas exactas de clases/roles/testids que hoy están asertadas están en `design.md` §Guardrails y `explore.md` §4. Cualquier fallo que no sea la celda del calendario se trata como regresión, no como test a editar.

## Registro de verificación

- Suites: **50/50 archivos, 568/568 tests**; `tsc --noEmit` exit 0
- Build: export estático OK (14 rutas)
- En vivo 1440×900: 7 rutas sin desborde, capturas en `/tmp/verify/after/`
- En vivo 390×844: 7 rutas sin desborde; calendario expandido sin desborde interno; modales topados y con el fondo bloqueado
- Consola limpia: sí (0 errores en ambos viewports)
- Regresión funcional: 16/16 en el build final
- Día del Juicio: 2 revisores ciegos independientes. Ronda 1: A con hallazgos, **B BLOQUEÓ** (MAJOR de la fila de suscripciones + CRITICAL: la evidencia no vinculaba al árbol final). Ronda 2: arreglados los 7 hallazgos, evidencia regenerada contra el hash congelado `35699ea6…`; el juez B re-juzgó y emitió **APPROVED**. Registro completo en `openspec/changes/2026-10-04-ui-polish-responsive/judgment-day.md`
- Regresión de caminos de UI: 7/7 (transferencia desde el modal, edición de saldo, token creado y «Copiar»)
- Hallazgo del juicio que quedó como recomendación para el dueño: `frontend/tsconfig.tsbuildinfo` sigue sin trackear y sin `.gitignore`
