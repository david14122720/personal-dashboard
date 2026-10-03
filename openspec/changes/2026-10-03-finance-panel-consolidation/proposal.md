# Proposal — 2026-10-03-finance-panel-consolidation

## Why

Tres redundancias visibles en la pantalla principal de Finanzas y en el Resumen General hacen que el
usuario lea dos veces la misma información y que el bloque más usado de la app (cargar un movimiento y
mirar la lista) esté partido en dos paneles:

- **Cargar y mirar son la misma tarea.** "Agregar movimiento" (dos botones) y "Movimientos" (lista con
  filtros) viven en dos paneles lado a lado. Después de cargar un gasto, lo natural es verlo aparecer
  abajo: hoy eso implica saltar de panel.
- **"Patrimonio Neto" y "Saldo Total" responden la misma pregunta** (cuánto tengo). En una pantalla de
  uso diario, una tarjeta que repite el número de otra ocupa lugar y sugiere que son cosas distintas.
- **"Tiempo real" no informa nada.** Es un indicador verde permanente: no tiene estados, no cambia con
  nada, y afirma algo que el usuario no puede verificar ni accionar.
- **"Suscripciones activas" repite "Próximas suscripciones"** dentro del mismo "Resumen General". La
  primera lista lo que existe, la segunda ordena lo que está por vencer — es la que Sirve para decidir.

## What changes

1. **Un solo panel de movimientos.** Los botones "Agregar gasto" / "Agregar ingreso" pasan a la parte
   superior de un contenedor único, y debajo, en el mismo contenedor, quedan la lista de movimientos con
   sus filtros (Cuenta, Categoría, Tipo), la paginación de 5 + "Ver más" ×10 y el estado vacío tal como
   están hoy. No se quita ninguna funcionalidad de ninguno de los dos paneles: cambian la composición y
   los encabezados, no el comportamiento.
2. **Fuera "Patrimonio Neto"** de las **dos** pantallas donde se muestra (el dueño eligió ambos lugares tras
   ver el mapa): el ítem del strip de telemetría del Resumen, donde convive con "Saldo Total", y la línea de
   solo lectura dentro de "Activos y patrimonio" en Finanzas. "Saldo Total" queda como único número de
   patrimonio en el Resumen, y el panel de activos de Finanzas se queda con la lista de activos.
3. **Fuera "Tiempo real"** (indicador verde) del resumen de Finanzas, con su clave i18n.
4. **Fuera "Suscripciones activas"** del "Resumen General" del Resumen: componente, código, referencias,
   su fila en la lista de widgets y el `toActiveSubs` que sólo existía para alimentarlo. "Próximas
   suscripciones" queda como la única sección de suscripciones del Resumen.

## Decisions taken before implementation

- **Un solo panel con el título "Movimientos"** (no "Agregar movimiento"): el `region` del panel nace del
  `aria-label` de `SectionShell`, y las pruebas de unidad y el e2e buscan la región "Movimientos". Los
  botones "Agregar gasto"/"Agregar ingreso" quedan arriba, dentro de ese mismo panel, con la lista y sus
  filtros debajo. Las claves `finance.addMovementTitle`/`addMovementHint` quedan sin consumidor y se borran.
- **El indicador verde "Tiempo real" vive en el header global** (`AppShell`), no en la pantalla de Finanzas:
  el dueño lo ve en todas las páginas. Se elimina de ahí y con él la clave `nav.live`.
- **El ítem de patrimonio del strip de telemetría sale sólo a él**: "Cuentas", "Suscripciones" y "Saldo
  Total" se quedan, y la clave `dashboard.netWorth` sigue viva porque Reportes y Progreso la consumen.

## Impact

- Superficie esperada: la pantalla de Finanzas (composición y tarjetas de resumen) y los widgets del
  Resumen General (dashboard home). Todo frontend; el backend y los contratos de la API no se tocan.
- Riesgo principal: la lista de "Suscripciones activas" podría estar compartida con la sección de
  Suscripciones de la app. Antes de borrar hay que probar que el componente que se elimina no tiene otros
  consumidores; si los tiene, se elimina sólo del Resumen y el componente se conserva para su otro uso.
- Efecto secundario esperado: menos claves i18n y menos componentes; algunos tests de pantalla que
  afirman la presencia de "Patrimonio Neto", "Tiempo real" o "Suscripciones activas" necesitan reescribirse
  para afirmar su ausencia.

## Non-goals

- No se toca la lógica de carga de movimientos (formulario, validación, normalización de montos).
- No se cambia la paginación de 5 + 10 ni el reseteo por filtro implementados hoy.
- No se rediseña la sección de Suscripciones de la app (sólo se quita la lista duplicada del Resumen).
- No se introducen dependencias nuevas.
- No se entrega: sin commit, sin push, sin deploy (decisión del dueño).

## Verification

- Suites focales por unidad de trabajo y **suite completa** + `tsc --noEmit` + `pnpm build`.
- Verificación visual con Playwright en local contra la **DB de producción** (usuario efímero, borrado al
  cierre): panel unificado con ambos botones operativos y la lista integrada, ausencia de "Patrimonio
  Neto" y "Tiempo real", Resumen con "Próximas suscripciones" y sin "Suscripciones activas", consola sin
  errores.
- Revisión adversarial (judgment-day) sobre un componente importante, a criterio del ejecutor.
