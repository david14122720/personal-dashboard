# Delta for Habits Management

## ADDED Requirements

### Requirement: Today Status Read

The system MUST expose `GET /habits/today` returning the caller's habits with today's log state resolved in a single request. Each entry SHALL include `habit_id`, `name`, `habit_frequency`, `days_of_week`, `current_streak`, and `today_status` ∈ {`done`, `missed`, `skipped`, `pending`}. `pending` indicates no log yet for today on a scheduled day; non-scheduled days MAY be omitted or returned with `today_status: "skipped"`.

#### Scenario: Mixed today statuses

- GIVEN three habits: A (logged done today), B (logged missed today), C (scheduled today, no log)
- WHEN `GET /habits/today`
- THEN the response contains A with `today_status: "done"`, B with `"missed"`, C with `"pending"`
- AND each entry carries its `current_streak`

#### Scenario: No habits

- GIVEN a user with no habits
- WHEN `GET /habits/today`
- THEN the response is 200 with an empty array

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `GET /habits/today`
- THEN the system returns 401 with envelope `UNAUTHORIZED`
