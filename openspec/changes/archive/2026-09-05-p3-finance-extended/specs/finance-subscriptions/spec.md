# finance-subscriptions Specification

## Purpose

Lifecycle management of recurring financial commitments (subscriptions), including tracking of costs and activation status.

## Requirements

### Requirement: Subscription Management

The system MUST allow users to create, read, and delete subscription records.

#### Scenario: Create Subscription
- GIVEN an authenticated user
- WHEN the user creates a subscription with a name, cost, and billing cycle
- THEN the system SHALL create the record and set status to `active`
- AND return 201 Created

#### Scenario: Create Free Subscription
- GIVEN an authenticated user
- WHEN the user creates a subscription with a cost of 0.00
- THEN the system SHALL accept the record (Free tiers supported)
- AND return 201 Created

#### Scenario: Invalid Cost Format
- GIVEN an authenticated user
- WHEN the user submits a subscription with an invalid cost string
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Lifecycle Management

The system MUST support activation and cancellation of subscriptions.

#### Scenario: Cancel Subscription
- GIVEN an active subscription
- WHEN the user marks it as cancelled
- THEN the system SHALL update the status to `cancelled`
- AND return 200 OK

#### Scenario: Reactivate Subscription
- GIVEN a cancelled subscription
- WHEN the user marks it as active
- THEN the system SHALL update the status to `active`
- AND return 200 OK

### Requirement: Category Scoping

The system MUST ensure subscriptions are linked to the correct category kind.

#### Scenario: Invalid Category Kind
- GIVEN an authenticated user
- WHEN the user creates a subscription linked to a category with kind `savings` (instead of `subscription`)
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Ownership & Security

The system MUST restrict access to the user's own subscriptions.

#### Scenario: Unauthorized Access
- GIVEN an authenticated user
- WHEN the user attempts to modify a subscription belonging to another user
- THEN the system MUST return 404 Not Found
