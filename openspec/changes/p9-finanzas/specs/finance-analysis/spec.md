# Finance Analysis Specification

## Purpose

Análisis en texto simple y directo sobre agregados existentes: variación intermensual e insights de plantillas fijas en español, nunca asesoramiento financiero.

## Requirements

### Requirement: Month-over-Month Computation

The system MUST compute MoM variation with a pure `toMonthOverMonth` transform over `monthly-flow` (current vs previous month income/expense deltas + %).

#### Scenario: MoM delta correct

- GIVEN August expense `"400.00"` and September `"500.00"`
- WHEN `toMonthOverMonth` runs
- THEN it returns `+100.00` and `+25%` for expense

#### Scenario: Single month yields no delta

- GIVEN only one month in `monthly-flow`
- WHEN the analysis renders
- THEN the MoM line is omitted without errors

### Requirement: Savings and Averages Indicators

The `AnalysisSection` MUST show pure-computed indicators from `monthly-flow` + `by-category`: savings rate, income/expense averages, top category, highest-spend and highest-saving months. All money MUST be coerced string→number only in transforms and formatted COP.

#### Scenario: Indicators render

- GIVEN three months of flow plus `by-category` top `"Mercado"`
- WHEN `AnalysisSection` renders
- THEN it shows tasa de ahorro, promedios, top categoría and extreme months with correct COP values

### Requirement: Direct ES Template Insights

Insights MUST be a closed list of fixed Spanish templates in direct tone (owner decision, e.g. "Este mes gastaste N% más en X que el mes anterior"). At least 3 insights MUST render when data suffices. No LLM or free generation SHALL exist; templates live in `analysis.*` i18n keys with value interpolation only.

#### Scenario: Direct insight renders

- GIVEN September food spend 18% above August
- WHEN insights render
- THEN one line reads direct-tone Spanish with `18%` and category `"Mercado"` (exact template wording from i18n)

### Requirement: Non-Advisor Disclaimer

Every analysis render MUST include the Spanish non-advisor disclaimer ("análisis personal, no asesoramiento financiero").

#### Scenario: Disclaimer always visible

- GIVEN any populated or empty analysis
- WHEN `AnalysisSection` renders
- THEN the Spanish disclaimer is visible

### Requirement: Recurrent Versus Extraordinary Heuristic v1

The v1 heuristic MUST use `description` frequency within the selected period to label recurrent vs extraordinary spend. If frequency is inconclusive, that line MUST be omitted — never invented.

#### Scenario: Inconclusive heuristic omitted

- GIVEN all descriptions appear once in the period
- WHEN insights render
- THEN no recurrent/extraordinary line appears

#### Scenario: Recurrent line renders on frequency

- GIVEN `"Arriendo"` appearing every month in the period
- WHEN insights render
- THEN the recurrent template line names `"Arriendo"` in Spanish

### Requirement: Analysis Empty and i18n Contract

With no data the section MUST render the Spanish `EmptyState` plus the disclaimer. All strings MUST come from `analysis.*`/`finance.*` keys; hardcoded literals are forbidden. The section MUST respect `prefers-reduced-motion` and keyboard focus like all finance sections.

#### Scenario: Empty analysis

- GIVEN empty `monthly-flow` and empty `by-category`
- WHEN `AnalysisSection` renders
- THEN it shows the Spanish empty state and the disclaimer
