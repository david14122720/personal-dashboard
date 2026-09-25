//! Shared money parsing for finance DTOs.
//!
//! Wire amounts travel as strings (e.g. `"50.00"`) to avoid floating-point
//! drift; they are parsed into [`Decimal`] at the API boundary and rejected
//! with 422 when they are not positive or exceed 2 decimal places.

use rust_decimal::Decimal;
use std::str::FromStr;

use crate::error::AppError;

// Money parsers share one shape: trim → Decimal::from_str → range/scale guard →
// AppError::Validation (422). `parse_money_amount` is live in P2 routes; the two
// new variants carry #[allow(dead_code)] until the P3 route slices call them.
// All three parsers are covered by unit tests below.
/// Parse a wire-format money string into [`Decimal`].
///
/// Accepts values `> 0` with at most 2 decimal places (`"50.00"`, `"10.5"`).
/// Rejects empty/non-numeric input, zero, negatives, and `scale > 2`
/// (`"10.005"`) with [`AppError::Validation`] (422).
pub fn parse_money_amount(raw: &str) -> Result<Decimal, AppError> {
    let trimmed = raw.trim();
    let amount = Decimal::from_str(trimmed).map_err(|_| {
        AppError::Validation("amount must be a positive number with at most 2 decimals".into())
    })?;
    if amount <= Decimal::ZERO || amount.scale() > 2 {
        return Err(AppError::Validation(
            "amount must be a positive number with at most 2 decimals".into(),
        ));
    }
    Ok(amount)
}

// Allowed until subscription/asset routes (P3 slices 4-5) call it; covered by unit tests.
#[allow(dead_code)]
/// Parse a non-negative wire-format money string into [`Decimal`].
///
/// Accepts values `>= 0` with at most 2 decimal places (`"0.00"` free-tier
/// prices, `"50.00"` valuations). Rejects empty/non-numeric input,
/// negatives, and `scale > 2` with [`AppError::Validation`] (422).
pub fn parse_money_amount_nonneg(raw: &str) -> Result<Decimal, AppError> {
    let trimmed = raw.trim();
    let amount = Decimal::from_str(trimmed).map_err(|_| {
        AppError::Validation("amount must be a non-negative number with at most 2 decimals".into())
    })?;
    if amount < Decimal::ZERO || amount.scale() > 2 {
        return Err(AppError::Validation(
            "amount must be a non-negative number with at most 2 decimals".into(),
        ));
    }
    Ok(amount)
}

/// Parse a manual account-balance string into [`Decimal`].
///
/// Accepts signed values (debtor cards are negative, e.g. `"-750.50"`)
/// with at most 2 decimal places and `|x| < 10^6` (`"980000.00"`,
/// `"-750.50"`, `"0"`). Rejects empty/non-numeric input, `scale > 2`
/// (`"10.005"`), and `|x| >= 10^6` (`"1000000.00"`) with
/// [`AppError::Validation`] (422). The balance is user-asserted data:
/// no trigger or aggregate rewrites it (migration 0011 removes the only
/// writer). A JSON number never reaches this parser — `balance` is
/// `Option<String>` on the PATCH DTO, so `deny_unknown_fields` +
/// deserialization reject numbers at the boundary (422) before parsing.
pub fn parse_balance_amount(raw: &str) -> Result<Decimal, AppError> {
    let trimmed = raw.trim();
    let amount = Decimal::from_str(trimmed).map_err(|_| {
        AppError::Validation(
            "balance must be a decimal string with at most 2 decimals and absolute value below 1000000"
                .into(),
        )
    })?;
    if amount.scale() > 2 || amount.abs() >= Decimal::new(1_000_000, 0) {
        return Err(AppError::Validation(
            "balance must be a decimal string with at most 2 decimals and absolute value below 1000000"
                .into(),
        ));
    }
    Ok(amount)
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
    fn accepts_two_decimal_amount() {
        assert_eq!(parse_money_amount("50.00").unwrap(), Decimal::new(5000, 2));
    }

    #[test]
    fn accepts_one_decimal_and_minimum_cent() {
        assert_eq!(parse_money_amount("10.5").unwrap(), Decimal::new(105, 1));
        assert_eq!(parse_money_amount("0.01").unwrap(), Decimal::new(1, 2));
    }

    #[test]
    fn rejects_zero_and_negative_as_422() {
        for raw in ["0.00", "0", "-10.00", "-0.01"] {
            assert_422(parse_money_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn rejects_scale_above_two_as_422() {
        for raw in ["10.005", "0.001", "99.999"] {
            assert_422(parse_money_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn rejects_empty_and_non_numeric_as_422() {
        for raw in ["", "   ", "abc", "12,50"] {
            assert_422(parse_money_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn nonneg_accepts_zero_as_valid() {
        assert_eq!(
            parse_money_amount_nonneg("0.00").unwrap(),
            Decimal::new(0, 2)
        );
    }

    #[test]
    fn nonneg_accepts_positive_amounts() {
        assert_eq!(
            parse_money_amount_nonneg("50.00").unwrap(),
            Decimal::new(5000, 2)
        );
        assert_eq!(
            parse_money_amount_nonneg("0.01").unwrap(),
            Decimal::new(1, 2)
        );
    }

    #[test]
    fn nonneg_trims_surrounding_whitespace() {
        assert_eq!(
            parse_money_amount_nonneg("  5.00  ").unwrap(),
            Decimal::new(500, 2)
        );
    }

    #[test]
    fn nonneg_rejects_negative_as_422() {
        for raw in ["-10.00", "-0.01"] {
            assert_422(parse_money_amount_nonneg(raw).unwrap_err());
        }
    }

    #[test]
    fn nonneg_rejects_scale_above_two_as_422() {
        for raw in ["10.005", "0.001"] {
            assert_422(parse_money_amount_nonneg(raw).unwrap_err());
        }
    }

    #[test]
    fn nonneg_rejects_empty_and_non_numeric_as_422() {
        for raw in ["", "   ", "abc", "12,50"] {
            assert_422(parse_money_amount_nonneg(raw).unwrap_err());
        }
    }

    #[test]
    fn balance_accepts_signed_zero_and_large_valid() {
        assert_eq!(
            parse_balance_amount("980000.00").unwrap(),
            Decimal::new(98000000, 2)
        );
        assert_eq!(
            parse_balance_amount("-750.50").unwrap(),
            Decimal::new(-75050, 2)
        );
        assert_eq!(parse_balance_amount("0").unwrap(), Decimal::ZERO);
    }

    #[test]
    fn balance_rejects_scale_and_range_as_422() {
        for raw in ["10.005", "1000000.00", "-1000000", "abc", ""] {
            assert_422(parse_balance_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn balance_json_number_rejected_before_parser() {
        // `balance` is `Option<String>` on the PATCH DTO: a JSON number
        // fails deserialization (axum surfaces it as 422) and never
        // reaches `parse_balance_amount`.
        let payload = serde_json::json!({"balance": 980000.00});
        assert!(
            serde_json::from_value::<BalanceStringProbe>(payload).is_err(),
            "numeric balance must fail deserialization"
        );
        let ok: BalanceStringProbe =
            serde_json::from_value(serde_json::json!({"balance": "-750.50"})).unwrap();
        assert_eq!(ok.balance.as_deref(), Some("-750.50"));
    }

    #[derive(Debug, serde::Deserialize)]
    struct BalanceStringProbe {
        balance: Option<String>,
    }
}
