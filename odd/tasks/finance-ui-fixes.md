# Finance UI fixes — Cuentas, Movimientos, gráfica de categoría y Comparar

## Objective

Corregir cuatro superficies de Finanzas pedidas por el dueño (2026-10-03), todo frontend, sin dependencias
nuevas y sin entrega: (1) Cuentas sin redundancia, conservando la etiqueta de tipo; (2) Movimientos
paginados 5 + "Ver más" ×10 con reset por filtro; (3) gráfica de líneas Gastos/Ingresos por categoría con
selector Día/Semana/Mes/Año; (4) la misma gráfica con 4 líneas en la vista Comparar categorías.

**Estado: CERRADO Y ENTREGADO** — 4/4 puntos implementados y verificados en vivo. El dueño autorizó después
commit + push a main (deploy manual suyo): **`a7fe0b4`** (código, 16 archivos) + **`f7c6fe1`** (artefactos SDD),
pusheados como `6f5d9fa..f7c6fe1`. Reporte completo en
`openspec/changes/2026-10-03-finance-ui-fixes/verify-report.md`.

## Target

- Trabajo: repo `/home/david/Nextcloud2/Ubuntu/landing_personal`, rama `main`, base `6f5d9fa`.
- SDD: `openspec/changes/2026-10-03-finance-ui-fixes/` (explore, proposal, 3 delta specs, design, tasks, verify-report).
- Verificación en vivo: local, backend contra la **DB de producción** (`192.168.50.120:5434`, autorizada por el dueño) + Playwright.

## Decisions

- **Entrega**: primera decisión del dueño "solo local"; al cierre autorizó **commit + push a main** con deploy a
  su cargo. Hecho: `a7fe0b4` (código) + `f7c6fe1` (SDD), `6f5d9fa..f7c6fe1` en `origin/main`. Nada de `odd/`,
  `.pi/`, `.codegraph/` ni generados entró al repo (precedente de la casa). Patch de respaldo previo al commit:
  `odd/tasks/finance-ui-fixes-delta.patch`.
- Reglas duras: no romper funcionalidad no mencionada; no instalar dependencias nuevas (`recharts` ya está);
  no tocar el backend (`GET /api/movements` sigue devolviendo todo — la paginación es de presentación).
- N por periodo: **Día 14 · Semana 8 · Mes 12 · Año 5** (semana desde lunes, incluida la unidad en curso,
  buckets vacíos en 0, orden viejo→nuevo), definidos en `TREND_BUCKETS` (`frontend/lib/finance/finance.ts`).
- `CategoryBars` quedó muerto al reemplazar la barra en ambas vistas → se eliminó con sus tests.
- `PeriodSelector` de Reportes NO se tocó (semántica de rango ≠ buckets).
- Datos de prueba: usuario efímero + seed SQL en la DB de prod; usuario borrado al cierre (cascada, 0 huérfanos).

## Tasks

- [x] W0 — SDD: explore + proposal + specs + design + tasks
- [x] W1 — Cuentas: una sola representación con tipo (delegado, 26 tests verdes)
- [x] W2 — Movimientos: 5 + 10 acumulativo con reset por filtro (delegado, 12 tests verdes)
- [x] W3 — Núcleo de tendencia: helper + `TrendPeriodSelector` + `CategoryTrendChart` (delegado, 33 tests verdes)
- [x] W4 — Wire-up de la sección y de Comparar + baja de `CategoryBars` (delegado, 10 tests verdes)
- [x] C1 — Gate: `pnpm test` **418/418** + `tsc --noEmit` exit 0 + `pnpm build` exit 0 (13 rutas)
- [x] C2 — Playwright en local contra la DB de prod: **29/29 checks**, 0 errores de consola, 0 `pageerror`
- [x] C3 — `verify-report.md` + patch de respaldo con sha256

## Evidence

- **Commits**: `a7fe0b4` `feat(finance): account de-duplication, movements paging and category trend charts`
  (16 archivos, +1083/−412) y `f7c6fe1` `docs(openspec): record the finance UI fixes change` (7 archivos SDD).
  Push: `6f5d9fa..f7c6fe1 main -> main`.
- **Delta**: 12 archivos modificados **+856/−412** + 4 archivos nuevos (227 líneas). Patch previo al commit en
  `odd/tasks/finance-ui-fixes-delta.patch` (1905 líneas, 16 archivos), sha256
  `91fe97048c573edd9191bdd0293ca6885ac4e93c319e197757c27256f9d0c348`.
- **Suites focales**: W1 26 · W2 12 · W3 33 · W4 10 · `finance.test.tsx` 15. Suite completa **418/418**.
- **Tipos/build**: `tsc --noEmit` exit 0; `pnpm build` exit 0, `frontend/out` regenerado.
- **En vivo (29/29)**: 1 cuenta = 1 fila con chip de tipo y sin barras de tarjeta; 5 filas → "Ver más" → 15
  (las 5 primeras intactas) → 18 y botón oculto; filtro Tipo con 18 visibles vuelve a 5 sin cambiar el
  filtro; gráfica con 2 series + leyenda + 4 periodos (Mes por defecto, 14 puntos en Día) y eje Y compacto;
  Comparar con 4 series etiquetadas (categoría B punteada); 768 y 390 sin errores.
- **Capturas**: `/tmp/verify-uifix/` (12 PNG) + `results.json`.
- **DB**: seed `odd/tasks/prod-seed-ui-fixes.sql`; usuario efímero borrado; 0 movimientos huérfanos; la DB
  volvió a los datos del dueño (2 usuarios, 4 cuentas, 37 movimientos, 7 categorías).

## Follow-ups (reportados al dueño)

- La etiqueta de tipo se muestra cruda (`digital_wallet`, `credit_card`): un mapa en español es decisión de producto.
- Con las tarjetas se perdió el LED de alerta y la barra de uso de tarjeta de crédito.
- Historias pendientes de la gráfica: `Mes` en septiembre se rotula `sept` (Intl) en vez de `sep`.
- La vista `compare` sigue sin cobertura e2e y sin entrada de menú (por diseño previo).
- Si el histórico de movimientos crece a miles de filas, la paginación debe migrar a backend.
