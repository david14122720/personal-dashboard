# Delta for finance-transfers

## ADDED Requirements

### Requirement: Card Payments via Transfers

The system SHOULD support the use of transfers to record payments made from a bank account to a credit card account.

#### Scenario: Pay credit card bill
- GIVEN a bank account {bank_id} with balance 1000.00 and a credit card account {card_id} with balance -500.00
- WHEN a user records a transfer of 500.00 from `{bank_id}` to `{card_id}`
- THEN the system SHALL return 201 Created
- AND `{bank_id}` balance MUST become 500.00
- AND `{card_id}` balance MUST become 0.00
