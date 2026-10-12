# Resumen + Finanzas + Configuración (cuentas y categorías)

## Objective
Simplificar Resumen, uniformar Finanzas, eliminar Tarjetas, simplificar Suscripciones,
gestionar cuentas bancarias y categorías desde Configuración, y agregar gráfica por
categoría + vista de comparativa. Todo en local, sin commit/push/deploy.

## Decisions
- **Cuentas bancarias (5): backend real.** `POST /accounts {name, type:"bank"}` +
  `DELETE /accounts/{id}` ya existen; Finanzas lista cuentas del backend, así que lo
  creado aparece automáticamente. Nuevo helper `createBankAccount` en `lib/api/finance`.
- **Categorías custom (6): solo frontend (localStorage `pd-custom-categories`).**
  El backend solo tiene `GET /categories` (sin POST/DELETE); agregar endpoints +
  migración queda fuera del alcance. En Finanzas se fusionan (backend finance + custom)
  para los selects de clasificación.
- **Gráfica por categoría (7):** gastos = suscripciones activas de la categoría
  (equivalente mensual por frecuencia); ahorro = lo ahorrado en metas de la categoría.
  Etiquetas honestas, barras con divs (sin dependencias nuevas).
- **Comparativa (8):** ruta `/dashboard/finance/compare/` + botón en Finanzas. Sin
  ítem de menú (el TopBar la agrupa bajo Finanzas por prefijo).
- **Tarjetas (3):** se elimina `manageCards` + `CardForm` + `CardDetail`. Las cuentas
  `credit_card` existentes se siguen listando en Cuentas (sin pérdida de datos).
- **Suscripciones (4):** `toSubscriptionRows` → detalle solo con fecha próxima de cobro;
  monto = equivalente mensual por frecuencia.

## Tasks
- [ ] P1 Resumen: quitar badge `v2.4 Telemetría` + ajustar tests
- [ ] P2 Finanzas: grid uniforme (4 secciones mismo span + `h-full`) + hint Cuentas
- [ ] P3 Tarjetas: quitar `manageCards`, borrar `CardForm`/`CardDetail`, ajustar tests/e2e
- [ ] P4 Suscripciones: simplificar filas (nombre + precio mensual + fecha)
- [ ] P5 Configuración cuentas: sección + página `/dashboard/ajustes/` + nav
- [ ] P6 Configuración categorías: CRUD localStorage + fusión en selects de Finanzas
- [ ] P7 Gráfica por categoría en Finanzas
- [ ] P8 Vista `/dashboard/finance/compare/` + botón (sin menú)
- [ ] i18n ES: claves nuevas (sin borrar claves viejas en uso por tests)
- [ ] Tests: vitest suites enfocadas + `tsc --noEmit` en verde
- [ ] Verificación visual: backend local + export estático + Playwright (8 puntos,
      3 viewports, 0 errores de consola) + usuario temporal eliminado

## Evidence
- `tsc --noEmit`: exit 0. `pnpm test`: 35 files, 319 tests, all green.
- `pnpm build`: 13 static routes (incl. `/dashboard/ajustes` y `/dashboard/finance/compare`).
- Playwright en vivo (backend debug + `frontend/out`, usuario temporal eliminado
  después): badge 0, crear-tarjeta 0, fila sub solo nombre+fecha+precio,
  cuenta creada/borrada por UI y reflejada en Finanzas, categoría custom creada
  y visible en el selector de Finanzas, gráfica Comida $30.000/$50.000,
  comparativa Comida vs Sueldo sin ítem de nav, 0 errores de consola.
- Capturas: /tmp/verify-01-resumen.png, 02-finanzas, 03-finanzas-categoria,
  04-comparativa, 05-ajustes, 06-finanzas-final, 07-finanzas-mobile,
  08-resumen-mobile, 09-finanzas-tablet.
- Nota: el backend solo acepta `category_id` de kind subscription en
  suscripciones (422 con kind finance, preexistente); el gasto demo se sembró
  por SQL para probar el gráfico. Sin commit/push/deploy por regla del objetivo.
