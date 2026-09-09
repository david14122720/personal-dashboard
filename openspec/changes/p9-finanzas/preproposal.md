# Pre-proposal state: p9-finanzas

schema: gentle-ai.sdd-preproposal/v1
revision: 1
change: p9-finanzas
project: personal-dashboard
date: 2026-09-09
pace: auto
artifact_store_mode: openspec
delivery_strategy: ask-on-risk

## Confirmed (objetivo.md afilado + grill-me + explore)
- Solo COP, todo manual sin UUIDs, presupuestos solo aviso visual, deudas simple.
- S5: presupuestos/ahorros/deudas/subs/tarjetas escritura total en FE.
- S6: 5 gráficos (saldo, ingresos-por-fuente, ahorro, gastos mensuales, comparativa) + selector período + MoM/insights plantillas ES no-asesor. Evolución patrimonio NO (patrimonio número simple).
- Sin migraciones. Triggers revierten en DELETE. Valuaciones INSERT-only.
- Límite duro: no tocar Fase 1 ni Fase 2.

## Pending product decisions (preguntadas al dueño 2026-09-09)
1. budget-edit: presupuesto existente ¿editar o borrar+crear?
2. payment-edit: abono de deuda ¿corregible/eliminable o solo agregar?
3. default-period: período inicial de gráficos ¿mes actual o 12 meses?
4. insights-tone: insights ¿frase directa o neutra?

## Resolved 2026-09-09 (dueño)
- budget-edit: editar (PATCH /budgets/{id})
- payment-edit: corregible (abono editable/eliminable)
- default-period: mes actual
- insights-tone: directo ("gastaste 18% más en...")
product_decisions: confirmed
