# Finance Budgets Specification

## Purpose
Category-based spending caps with on-demand status monitoring.

## Requirements

### Requirement: Budget Creation & Validation
The system MUST allow users to set spending limits for specific categories over a date range.

#### Scenario: Successfully create budget
- GIVEN an authenticated user and a category {id}
- WHEN they create a budget: amount='500.00', period_start='2026-09-01', period_end='2026-09-30'
- THEN the system returns 201 Created

#### Scenario: Invalid period
- GIVEN an authenticated user
- WHEN they set `period_end` earlier than `period_start`
- THEN the system returns 422 Unprocessable Entity

#### Scenario: Negative or zero amount
- GIVEN an authenticated user
- WHEN they set budget amount to '0.00' or '-10.00'
- THEN the system returns 422 Unprocessable Entity

### Requirement: Budget Status Computation
The system MUST compute the spent, remaining, and percentage used on-demand.

#### Scenario: Compute budget status
- GIVEN a budget of '100.00' for "Food" and total expenses of '85.00' in that period
- WHEN the user requests budget status
- THEN the system returns:
    - spent: '85.00'
    - remaining: '15.00'
    - pct: 0.85

### Requirement: Threshold Alerting
The system MUST map the computed percentage to a status based on `warn_threshold` and `over_threshold`.

#### Scenario: Warning status
- GIVEN a budget with `warn_threshold` = 0.8 and `over_threshold` = 1.0
- WHEN current spending is 85% (0.85)
- THEN the system returns status: 'warn'

#### Scenario: Over budget status
- GIVEN a budget with `over_threshold` = 1.0
- WHEN current spending is 110% (1.10)
- THEN the system returns status: 'over'

#### Scenario: OK status
- GIVEN a budget with `warn_threshold` = 0.8
- WHEN current spending is 40% (0.40)
- THEN the system returns status: 'ok'
