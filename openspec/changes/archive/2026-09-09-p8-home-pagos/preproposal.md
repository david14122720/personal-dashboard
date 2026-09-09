# Pre-proposal state: p8-home-pagos

schema: gentle-ai.sdd-preproposal/v1
revision: 1
change: p8-home-pagos
project: personal-dashboard
date: 2026-09-09
pace: auto
artifact_store_mode: openspec
delivery_strategy: ask-on-risk

## Confirmed (del grill-me + explore)
- Solo COP, todo manual sin UUIDs, presupuestos solo aviso, deudas simple.
- S3: dashboard completo con widgets faltantes + personalización vía PATCH /me/preferences.
- S4: avisos solo in-app (campanita + vencidas + próximos cobros), sin push/email.
- FE-only: componer con endpoints existentes, sin agregaciones BE nuevas.
- Límite duro: no tocar Fase 1 (S1/S2).

## Pending product decisions (preguntadas al dueño 2026-09-09)
1. widget-split: ingresos/gastos/ahorro del mes ¿1 widget combinado o 3 separados?
2. upcoming-window: ventana de próximos pagos ¿7 / 15 / 30 días?
3. bell-placement: ubicación de la campanita ¿header home / rail / flotante?
4. customize-ux: personalización ¿toggles en el home o pantalla de ajustes?

## Resolved 2026-09-09 (dueño)
- widget-split: 3 separados (ingreso / gasto / ahorro del mes)
- upcoming-window: 7 días
- bell-placement: header del home
- customize-ux: toggles en el home
product_decisions: confirmed
