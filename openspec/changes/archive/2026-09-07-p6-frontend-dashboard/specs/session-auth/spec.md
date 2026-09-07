# Delta for Session Auth

## ADDED Requirements

### Requirement: Preferences Persistence

The system MUST expose `PATCH /me/preferences` accepting a partial body of `{ currency_code, locale, timezone, dashboard_layout }`. Only supplied fields SHALL be updated; omitted fields MUST remain unchanged. The endpoint MUST return 200 with the merged preferences object. Invalid values (unknown currency code, malformed locale/timezone) MUST return 422.

#### Scenario: Partial update of dashboard layout

- GIVEN a user with `currency_code: "COP"`, `dashboard_layout: null`
- WHEN `PATCH /me/preferences` with `{ dashboard_layout: { widgets: [{ id: "monthly-flow", type: "chart", order: 0, size: "lg" }] } }`
- THEN the response is 200 with the new `dashboard_layout` and `currency_code` still `"COP"`

#### Scenario: Invalid timezone rejected

- GIVEN an authenticated user
- WHEN `PATCH /me/preferences` with `{ timezone: "Not/AZone" }`
- THEN the system returns 422 and no field is modified

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `PATCH /me/preferences`
- THEN the system returns 401 with envelope `UNAUTHORIZED`

### Requirement: Client-Side 401 Handling Contract

Any authenticated endpoint that receives an expired, revoked, or malformed token MUST return 401 with the JSON envelope `{ code: "UNAUTHORIZED", message: string }` and MUST NOT return 403 for authentication failures. Clients rely on this contract to perform a single-flight redirect to login and clear stored tokens.

#### Scenario: Expired token returns 401 envelope

- GIVEN a request with an expired bearer token to any protected endpoint
- WHEN the request is processed
- THEN the response is 401 with body `{ code: "UNAUTHORIZED", ... }`

#### Scenario: 403 is not used for auth failures

- GIVEN any request failing authentication (missing, malformed, expired, or revoked token)
- WHEN the request is processed
- THEN the response status is 401 (never 403)
