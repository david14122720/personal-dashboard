//! Shared money parsing for finance DTOs.
//!
//! Wire amounts travel as strings (e.g. `"50.00"`) to avoid floating-point
//! drift; they are parsed into [`Decimal`] at the API boundary and rejected
//! with 422 when they are not positive or exceed 2 decimal places.

use rust_decimal::Decimal;
use std::str::FromStr;

use crate::error::AppError;

// Allowed until transaction/transfer routes (PR2-PR3) call it; covered by unit tests.
#[allow(dead_code)]
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
}
