# Frontend i18n Specification

## Purpose

Single-locale Spanish layer: typed ES dictionary, `t()`, Intl formatters, Spanish document locale. Dictionary values are Spanish by design; code and comments stay English.

## Requirements

### Requirement: Typed ES Dictionary and Coverage

All user-visible strings — labels, aria-labels, placeholders, errors, page titles — MUST live in one type-checked ES dictionary consumed via `t(key)`; unknown keys MUST fail the build and hardcoded English UI literals MUST NOT remain. No other locale mechanism SHALL exist.

#### Scenario: Unknown key fails at build

- GIVEN code calling `t("missing.key")`
- WHEN type-checking runs
- THEN the build fails

#### Scenario: Sweep complete

- GIVEN the login, overview, finance, and productivity pages
- WHEN rendered
- THEN only Spanish copy is visible

### Requirement: ES Date and Money Formatting

`YYYY-MM` months and dated labels MUST render via Spanish Intl formatters. `formatMoney` MUST keep es-CO/COP defaults and MUST fall back to Spanish — never `en-US` — when Intl throws.

#### Scenario: Chart month label

- GIVEN aggregate month `"2026-09"`
- WHEN a chart axis renders it
- THEN the Spanish month form is shown

#### Scenario: Invalid currency fallback

- GIVEN `formatMoney` with currency `"XX1"`
- WHEN formatted
- THEN grouping is Spanish (`1.500.000`)

### Requirement: Spanish Document Language and Metadata

The root layout MUST declare `lang="es"` and Spanish metadata title/description.

#### Scenario: Language declared

- GIVEN the built HTML document
- WHEN parsed
- THEN `<html lang="es">` and a Spanish `<title>` are present

### Requirement: ES-First Test Acceptance

Spanish assertions MUST be written before each page sweep turns them green; every commit MUST leave the suite green. This slice MUST carry a judgment-day evidence hook: dual review of key naming + missed-locale audit.

#### Scenario: Red before green

- GIVEN new ES assertions for an unswept page
- WHEN the suite runs pre-implementation
- THEN they fail until the sweep lands
