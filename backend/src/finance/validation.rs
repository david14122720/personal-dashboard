//! Shared finance validation helpers (survives the S1–S3 removals).
//!
//! Canonical home of [`validate_occurred_on`] (date parse → 422) and
//! [`ensure_finance_category`] (owned + `kind='finance'` → 422), moved here
//! verbatim from `routes/transactions.rs` (same logic, same Spanish messages)
//! so the later removal slices stay compilable. Every surviving consumer
//! imports from `crate::finance::validation`; `routes/transactions.rs` keeps
//! its own duplicate until S3a deletes that module, and `routes/budgets.rs`
//! / `routes/transfers.rs` keep theirs until S1/S2 delete them.

use chrono::NaiveDate;
use uuid::Uuid;

use crate::error::AppError;

pub(crate) const CATEGORY_LOOKUP_SQL: &str =
    "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";

/// Parse `occurred_on` as a calendar date (strict `YYYY-MM-DD`), else 422.
///
/// S0 preparatory home: no surviving writer consumes this yet (debts /
/// savings / accounts keep their field-specific date validators with
/// different messages, and `budgets.rs` / `transfers.rs` keep their own
/// copies until S1/S2 delete them). The unit tests below lock the behaviour
/// so S3a can resolve every remaining date validation against this module.
#[allow(dead_code)]
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

/// Verify the category is owned AND `kind='finance'` (else 422 per design:
/// FK + kind mismatch + unowned all map to 422, never 404).
pub async fn ensure_finance_category(
    pool: &sqlx::PgPool,
    category_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let kind: Option<String> = sqlx::query_scalar(CATEGORY_LOOKUP_SQL)
        .bind(category_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    match kind.as_deref() {
        Some("finance") => Ok(()),
        _ => Err(AppError::Validation(
            "category must be an owned finance category".into(),
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

    #[test]
    fn category_lookup_scopes_by_user_and_reads_kind() {
        assert!(
            CATEGORY_LOOKUP_SQL.contains("user_id"),
            "category check must scope by user_id, got: {CATEGORY_LOOKUP_SQL}"
        );
        assert!(
            CATEGORY_LOOKUP_SQL.contains("kind::text"),
            "category check must read kind, got: {CATEGORY_LOOKUP_SQL}"
        );
    }
}
