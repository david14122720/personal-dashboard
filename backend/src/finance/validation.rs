//! Shared finance validation helpers (survives the S1–S3 removals).
//!
//! Canonical home of [`validate_occurred_on`] (date parse → 422) and the
//! category/account ownership checks used by the surviving finance writers.
//! Every surviving consumer imports from `crate::finance::validation`.
//!
//! Kind gates (finance-simplify-movements D3): [`ensure_owned_category`] and
//! [`ensure_owned_account`] verify ownership only — any owned kind is
//! accepted for movements and subscriptions. The legacy
//! `ensure_finance_category` (`kind='finance'` gate) is gone with
//! `routes::savings` (S-G); new code MUST use [`ensure_owned_category`].

use chrono::NaiveDate;
use uuid::Uuid;

use crate::error::AppError;

/// Parse `occurred_on` as a calendar date (strict `YYYY-MM-DD`), else 422.
///
/// First live consumer: the movements routes (S-A). Previously only covered
/// by unit tests while debts / savings / accounts kept their field-specific
/// date validators.
pub fn validate_occurred_on(raw: &str) -> Result<NaiveDate, AppError> {
    let trimmed = raw.trim();
    let well_formed =
        trimmed.len() == 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-';
    if !well_formed {
        return Err(AppError::Validation(
            "occurred_on must be a calendar date YYYY-MM-DD".into(),
        ));
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("occurred_on must be a calendar date YYYY-MM-DD".into()))
}

/// Verify the category is owned by the caller, regardless of kind
/// (finance-simplify-movements D3: kind no longer gates writes).
///
/// Foreign or missing → 422 with a Spanish message, never 404 (same
/// convention as every surviving finance route: referenced body ids are
/// 422, URL-addressed ids are 404).
///
/// Generic over the executor so movement transactions can probe inside
/// their `sqlx::Transaction` (`&mut *tx`) while plain callers pass `&pool`.
pub async fn ensure_owned_category<'e, E>(
    db: E,
    category_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let owned: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM categories WHERE id=$1 AND user_id=$2")
            .bind(category_id)
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(|_| AppError::Internal)?;
    match owned {
        Some(_) => Ok(()),
        None => Err(AppError::Validation(
            "la categoria debe pertenecer al usuario".into(),
        )),
    }
}

/// Verify the account exists and is owned by the caller (existence +
/// ownership, no locking).
///
/// This is the fail-fast pre-transaction check. Inside a movement
/// transaction the locking variant (`SELECT ... FOR UPDATE`, inline in
/// `routes::movements`) runs instead, so concurrent writers serialize on
/// the account row. Foreign or missing → 422 Spanish, never 404.
pub async fn ensure_owned_account<'e, E>(
    db: E,
    account_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let owned: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM accounts WHERE id=$1 AND user_id=$2")
            .bind(account_id)
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(|_| AppError::Internal)?;
    match owned {
        Some(_) => Ok(()),
        None => Err(AppError::Validation(
            "la cuenta debe pertenecer al usuario".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn accepts_iso_calendar_date() {
        assert_eq!(
            validate_occurred_on("2026-09-01").unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        );
    }

    #[test]
    fn rejects_bad_dates_as_422() {
        for raw in [
            "",
            "2026-13-01",
            "2026-02-30",
            "01/09/2026",
            "2026-9-1",
            "not-a-date",
        ] {
            assert_422(validate_occurred_on(raw).unwrap_err());
        }
    }
}
