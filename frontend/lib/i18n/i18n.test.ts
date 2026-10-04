import { describe, expect, it } from "vitest";
import { chartToken, formatMonth, t } from "./index";

describe("i18n foundation", () => {
  it("resolves the Dashboard identity copy from the three existing keys", () => {
    expect(t("nav.overview")).toBe("Dashboard");
    expect(t("dashboard.overview")).toBe("Dashboard");
    expect(t("dashboard.overviewTitle")).toBe("Dashboard");
  });

  it("resolves core Spanish copy", () => {
    expect(t("nav.finance")).toBe("Finanzas");
    expect(t("login.submit")).toBe("Iniciar sesión");
    expect(t("common.loading")).toBe("Cargando…");
  });

  it("substitutes vars", () => {
    expect(t("common.greeting", { name: "Ana" })).toBe("Hola, Ana");
  });

  it("formats chart months in Spanish", () => {
    const label = formatMonth("2026-09");
    expect(label).not.toBe("2026-09");
    expect(label).toContain("2026");
  });

  it("returns invalid month keys untouched", () => {
    expect(formatMonth("not-a-month")).toBe("not-a-month");
    expect(formatMonth("2026-13")).toBe("2026-13");
  });

  it("rejects unknown keys at build time", () => {
    // @ts-expect-error unknown key must fail type-check
    expect(() => t("missing.key")).toThrow();
  });
});

describe("p8 dashboard + notifications copy (PR1 RED)", () => {
  it("resolves 4 widget titles and hints", () => {
    expect(t("dashboard.upcomingPayments")).toBeTruthy();
    expect(t("dashboard.pendingTasks")).toBeTruthy();
    expect(t("dashboard.upcomingEvents")).toBeTruthy();
    expect(t("dashboard.goalProgress")).toBeTruthy();
  });

  it("resolves the S-H overview strip and section copy", () => {
    expect(t("dashboard.totalBalance")).toBe("Saldo total");
    expect(t("dashboard.latestMovementsTitle")).toBe("Últimos movimientos");
    expect(t("dashboard.latestMovementsHint")).toBeTruthy();
    expect(t("dashboard.latestMovementsEmpty")).toBeTruthy();
    expect(t("dashboard.upcomingSubscriptionsTitle")).toBe("Próximas suscripciones");
    expect(t("dashboard.upcomingSubscriptionsHint")).toBeTruthy();
    expect(t("dashboard.upcomingSubscriptionsEmpty")).toBeTruthy();
    expect(t("dashboard.goalVsSavings")).not.toMatch(/ahorro/i);
    expect(t("dashboard.overviewSubtitle")).not.toMatch(/deuda/i);
  });

  it("resolves toggles, links and empties", () => {
    expect(t("dashboard.widgetHide")).toBeTruthy();
    expect(t("dashboard.widgetShow")).toBeTruthy();
    expect(t("dashboard.viewInFinance")).toBeTruthy();
    expect(t("dashboard.viewInProductivity")).toBeTruthy();
    expect(t("dashboard.upcomingPaymentsEmpty")).toBeTruthy();
  });

  it("resolves bell, sections and empty states", () => {
    expect(t("notifications.bell")).toBeTruthy();
    expect(t("notifications.overdue")).toBeTruthy();
    expect(t("notifications.upcomingCharges")).toBeTruthy();
    expect(t("notifications.noOverdue")).toBe("Sin vencidas 🎉");
    expect(t("notifications.noUpcoming")).toBe("Nada por vencer en 7 días");
  });

  it("interpolates {n} and {date}", () => {
    expect(t("notifications.bellLabel", { n: 4 })).toContain("4");
    expect(t("notifications.dueOn", { date: "12 sept" })).toContain("12 sept");
    expect(t("notifications.amountDue", { amount: "$ 500", date: "12 sept" })).toBe("$ 500 · vence 12 sept");
  });
});

describe("dashboard chart copy names the currency in scope", () => {
  it("interpolates the user currency in the totals empty note", () => {
    expect(t("dashboard.totalTrendEmpty", { currency: "COP" })).toBe(
      "Sin movimientos en COP en este periodo",
    );
  });

  it("interpolates the user currency in the pie empty note", () => {
    expect(t("dashboard.expensePieEmpty", { currency: "COP" })).toBe(
      "Sin gastos en COP en este periodo",
    );
  });

  it("states the currency scope in both chart hints", () => {
    expect(t("dashboard.totalTrendHint")).toMatch(/tu moneda/);
    expect(t("dashboard.expensePieHint")).toMatch(/tu moneda/);
  });
});

describe("productivity calendar copy (W4)", () => {
  it("resolves the calendar block copy", () => {
    expect(t("productivity.calendarTitle")).toBe("Calendario");
    expect(t("productivity.calendarToday")).toBe("Hoy");
    expect(t("productivity.calendarPrev")).toBe("Mes anterior");
    expect(t("productivity.calendarNext")).toBe("Mes siguiente");
    expect(t("productivity.calendarWeekdays").split(",")).toEqual([
      "Lun",
      "Mar",
      "Mié",
      "Jue",
      "Vie",
      "Sáb",
      "Dom",
    ]);
  });

  it("interpolates the day label and the marker counts", () => {
    expect(
      t("productivity.calendarDayLabel", { date: "15 de octubre", summary: "2 tareas, 1 evento" }),
    ).toBe("15 de octubre: 2 tareas, 1 evento");
    expect(t("productivity.calendarTasksMany", { n: 2 })).toBe("2 tareas");
    expect(t("productivity.calendarTasksOne")).toBe("1 tarea");
    expect(t("productivity.calendarEventsMany", { n: 3 })).toBe("3 eventos");
    expect(t("productivity.calendarEventsOne")).toBe("1 evento");
    expect(t("productivity.calendarDayEmptyLabel", { date: "15 de octubre" })).toBe(
      "15 de octubre: sin tareas ni eventos",
    );
  });

  it("resolves the day detail and empty/error copy", () => {
    expect(t("productivity.calendarDayDetail", { date: "15 de octubre" })).toBe(
      "Detalle de 15 de octubre",
    );
    expect(t("productivity.calendarEmptyDay")).toBeTruthy();
    expect(t("productivity.calendarEmptyMonth")).toBeTruthy();
    expect(t("productivity.calendarLoadFailed")).toBeTruthy();
  });
});

describe("chartToken", () => {
  it("reads CSS custom properties via getComputedStyle", () => {
    document.documentElement.style.setProperty(
      "--color-flow",
      "oklch(81% 0.14 195)",
    );
    expect(chartToken("--color-flow")).toBe("oklch(81% 0.14 195)");
    document.documentElement.style.removeProperty("--color-flow");
  });

  it("trims surrounding whitespace", () => {
    document.documentElement.style.setProperty("--color-signal", "  blue  ");
    expect(chartToken("--color-signal")).toBe("blue");
    document.documentElement.style.removeProperty("--color-signal");
  });

  it("returns empty string for unset tokens", () => {
    expect(chartToken("--color-missing-token")).toBe("");
  });
});

describe("S3b snapshot + balance-edit copy", () => {
  it("resolves the surviving period ranges", () => {
    expect(t("charts.periodWeek")).toBe("Semana");
    expect(t("charts.periodMonth")).toBe("Mes");
    expect(t("charts.periodQuarter")).toBe("Trimestre");
    expect(t("charts.periodYear")).toBe("Año");
    expect(t("charts.periodCustom")).toBe("Personalizado");
    expect(t("charts.periodInvalidRange")).toContain("no es válido");
  });

  it("labels the finance snapshot as a current value", () => {
    expect(t("reports.financeCurrent")).toBe("Valor actual");
    expect(t("reports.finance")).toBe("Finanzas actuales");
    expect(t("progress.finance")).toBe("Finanzas actuales");
    expect(t("progress.financeHint")).toContain("Patrimonio");
  });

  it("resolves the inline balance-edit copy with per-account labels", () => {
    expect(t("finance.balanceEdit")).toBe("Editar saldo");
    expect(t("finance.balanceEditLabel", { name: "Ahorros" })).toBe("Editar saldo de Ahorros");
    expect(t("finance.balanceInvalid")).toContain("válido");
    expect(t("finance.balanceSaved")).toBe("Saldo actualizado.");
    expect(t("finance.subtitle", { currency: "COP" })).not.toMatch(/mayor|presupuesto/i);
    expect(t("dashboard.overviewSubtitle")).not.toMatch(/presupuesto/i);
  });
});

// -- W2/W5: copia tipada de transferencias y filas de movimiento --
describe("transfer copy (W2/W5)", () => {
  // `finance.transferSaved` is deliberately re-introduced by design D6 with a
  // new value; it is the modal confirmation, not the deleted page/ledger family.
  it("resolves the transfer modal family with the exact design copy", () => {
    // Owner literal wording: both the entry button and the modal title say
    // «Mover dinero» (the owner's request wins over the design draft).
    expect(t("finance.addTransfer")).toBe("Mover dinero");
    expect(t("finance.transferModalTitle")).toBe("Mover dinero");
    expect(t("finance.transferFrom")).toBe("Cuenta origen");
    expect(t("finance.transferTo")).toBe("Cuenta destino");
    expect(t("finance.transferSaved")).toBe("Transferencia registrada.");
    expect(t("finance.transferSameAccountError")).toBe("Elige dos cuentas distintas.");
    expect(t("finance.transferCurrencyError")).toBe("Ambas cuentas deben usar la misma moneda.");
  });

  it("resolves the row labels and the direction filter option", () => {
    expect(t("finance.paymentMethod")).toBe("Método de pago");
    expect(t("finance.movementAccountLabel")).toBe("Cuenta");
    expect(t("finance.movementDirectionTransfer")).toBe("Transferencia");
    expect(t("finance.movementTransferRoute", { from: "Ahorros", to: "Nequi" })).toBe(
      "Transferencia: Ahorros → Nequi",
    );
  });

  it("preserves the subscription payment method Transferencia", () => {
    expect(t("finance.paymentTransfer")).toBe("Transferencia");
  });

  it("does not resurrect the deleted transfer page/ledger family", () => {
    const forbidden = [
      "finance.newTransfer",
      "finance.saveTransfer",
      "finance.transfersTitle",
      "finance.transfersSubtitle",
      "finance.transfersRegion",
      "finance.showingTransfers",
      "finance.noTransfers",
      "finance.noTransfersHint",
      "finance.loadingTransfers",
      "finance.transfersLoadFailed",
      "finance.transfersLoadFailedHint",
      "finance.transferDirection",
    ] as const;
    for (const key of forbidden) {
      // @ts-expect-error la familia retirada no existe en el diccionario
      expect(() => t(key)).toThrow(/Unknown i18n key/);
    }
  });
});

// -- W3/A5: copia tipada de la gestión de sesiones --
describe("session management copy (W3)", () => {
  it("resolves the sessions settings family", () => {
    expect(t("nav.sessions")).toBe("Sesiones");
    expect(t("settings.sessionsTitle")).toBe("Sesiones activas");
    expect(t("settings.sessionsCurrent")).toBe("Actual");
    expect(t("settings.sessionsCreated")).toBe("Inicio");
    expect(t("settings.sessionsExpires")).toBe("Expira");
    expect(t("settings.sessionsIp")).toBe("IP");
    expect(t("settings.sessionsRevokeOthers")).toBe("Cerrar otras sesiones");
    expect(t("settings.sessionsRevoking")).toBe("Cerrando…");
    expect(t("settings.sessionsRevokedOthers")).toBe("Sesiones cerradas.");
    expect(t("settings.sessionsEmpty")).toBe("Sin sesiones registradas");
    expect(t("settings.sessionsLoadFailed")).toBe("No se pudieron cargar las sesiones");
    expect(t("settings.sessionsRevokeFailed")).toBe(
      "No se pudieron cerrar las sesiones. Inténtalo de nuevo.",
    );
    expect(t("settings.sessionsRevokeConfirm")).toContain("Cerrar");
  });
});
