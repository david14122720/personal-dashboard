# Cierre 8 puntos — Resumen/Finanzas/Config (cierre-8-puntos) — DONE

## Objective
Completar lo PARTIAL de los 8 puntos (P3 restos, P6 brecha categorías, P7 gráfica),
pasar Judgment Day a los 2 componentes más críticos y pushear a main por orden del dueño.

## Result
P1-P8 PASS. main = origin/main en d22a220. JUDGMENT: APPROVED ✅ (dual-blind).

## Tasks
- [x] T1 Limpieza P1/P3 (writer, feat 808c938 → main 0a190f7): 11 claves i18n muertas fuera,
      e2e sin "Crear tarjeta". chartExpenses/chartSavings intactos (en uso).
- [x] T2 Fix P6 (writer, feat c3baaab → main d22a220): fetchSubscriptionCategories/
      useSubscriptionCategories, NamedOption.kind, FinanceScreens finance/subscription/unión,
      compare misma unión, hint noSubscriptionCategories. Sin 422 sorpresa.
- [x] T3 Fix P7 (writer, mismo commit): categoryChartTitle "Gastos y ahorro por categoría",
      settings copy local honesto, charts leen unión del flujo normal. Tests MSW por ?kind=.
- [x] T4 Checks: tsc 0; pnpm test 323/323 (feat) y 35 files/323 tests verde re-verificado en main;
      build 13/13; backend NO tocado (cargo test N/A).
- [x] T5 Judgment Day (dual-blind, odd/judgment-ledger-cierre-8pts.md): Judge A 1 WARNING
      pre-existing (currency en toCategoryTotals) + 3 SUGGESTION (h1 duplicado, test tautológico,
      empty-state); Judge B limpio tras retry; 0 severe → sin fix-round. APPROVED ✅.
- [x] T6 Review final + push: assess medium/under_budget (9 paths, 245 líneas, RDD off);
      spot check tsc exit 0 en main; cherry-pick 0a190f7 + d22a220 a main (docs-commit 30676f7
      queda solo en feat/cierre-8-puntos, odd/ local-only); push origin/main ac2cc52..d22a220 OK.

## Follow-ups (no bloqueantes, info del juicio)
- toCategoryTotals ignora row currency (pre-existing); h1 duplicado en compare; test card-removal
  tautológico; empty-state antes de elegir categoría; doc customCategories.ts:3-11 desactualizado.
- B2-backend (POST /categories) reportado como innecesario: GET ?kind=subscription ya existía.
- Deploy a prod lo hace el dueño. Rama feat/cierre-8-puntos conservada como archivo (30676f7).
