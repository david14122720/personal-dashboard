# Credit Card Summary Specification

## Purpose

Calculation and reporting of credit card usage metrics, billing cycles, and liability impact on net worth.

## Requirements

### Requirement: Usage Metrics Calculation

The system MUST compute derived metrics for credit card accounts to monitor credit health.

- `used_balance`: The absolute value of the current negative balance.
- `available_balance`: `credit_limit` minus `used_balance`.
- `usage_pct`: `(used_balance / credit_limit) * 100`.

#### Scenario: Compute standard metrics
- GIVEN a card with `credit_limit: 1000.00` and balance -300.00
- WHEN the summary is requested
- THEN the system SHALL return:
    - `used_balance`: 300.00
    - `available_balance`: 700.00
    - `usage_pct`: 30.0%

### Requirement: Usage Alert Levels

The system MUST assign an alert level based on the `usage_pct`.

- **OK**: `usage_pct` < 70%
- **Warn**: 70% $\le$ `usage_pct` < 90%
- **High**: `usage_pct` $\ge$ 90%

#### Scenario: Transition to High alert
- GIVEN a card with `credit_limit: 1000.00` and balance -910.00
- WHEN the summary is requested
- THEN the system SHALL return `alert_level: "High"`

### Requirement: Balance Types

The system MUST distinguish between the live current balance and the balance as of the last statement date.

- **Current Balance**: The real-time cached balance of the account.
- **Statement Balance**: The sum of all transactions linked to the account that occurred on or before the most recent `statement_day` of the billing cycle.

#### Scenario: Statement vs Current balance
- GIVEN a card where the last statement was on the 15th
- GIVEN transactions:
    - 10th: -100.00
    - 12th: -50.00
    - 20th: -200.00
- WHEN the summary is requested
- THEN `statement_balance` MUST be -150.00
- AND `current_balance` MUST be -350.00

### Requirement: Net Worth Liability Treatment

The system MUST treat credit card balances as liabilities when aggregating total assets.

- Credit card balances (which are typically negative) MUST be summed as-is.
- They MUST NOT be converted to positive values during asset summation; they MUST reduce the total net worth.

#### Scenario: Net worth summation
- GIVEN accounts:
    - Savings: 5000.00
    - Credit Card: -1000.00
- WHEN computing total net worth
- THEN the result MUST be 4000.00
