//! Subscription cycle math (finance-simplify-movements S-B, D2).
//!
//! All billing dates advance in whole calendar months with day-of-month
//! clamping, and "today" is the current date in `America/Bogota` without a
//! new dependency: Colombia has had no daylight saving time since 1993, so a
//! fixed UTC-05:00 offset is exact.
//!
//! [`advance_next_billing`] implements the design rule "first monthly
//! occurrence after `max(pay_date, stored_due)`": the anchor day comes from
//! the stored due date, each candidate steps whole months from it, and the
//! first candidate strictly after the threshold wins. This satisfies the
//! binding "Early payment counts for the cycle" scenario, which a plain
//! "strictly after the pay date" rule would fail.

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};

/// Fixed Bogota offset (UTC-05:00, no DST since 1993).
const BOGOTA_OFFSET_HOURS: i64 = 5;

/// Upper bound for the dormant-subscription catch-up loop; ~100 years of
/// months, after which the caller gets a plain pay-date-plus-one-month
/// fallback instead of an infinite loop.
const MAX_CATCH_UP_MONTHS: i32 = 1200;

/// Current date in `America/Bogota` (`Utc::now() - 5h`).
pub fn today_bogota() -> NaiveDate {
    today_bogota_at(Utc::now())
}

/// Pure-function seam for [`today_bogota`]: the same offset applied to an
/// injected clock, so tests never depend on the wall clock.
pub fn today_bogota_at(now: DateTime<Utc>) -> NaiveDate {
    (now - Duration::hours(BOGOTA_OFFSET_HOURS)).date_naive()
}

/// Last valid day of a calendar month (handles February leap years).
fn last_day_of_month(year: i32, month: u32) -> u32 {
    let first_of_next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1).expect("next year January exists")
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1).expect("next month exists")
    };
    first_of_next.pred_opt().expect("month has a last day").day()
}

/// Add `months` calendar months to `base`, clamping the day to the last
/// valid day of the target month. The anchor day always comes from `base`,
/// so `2026-01-31 + 2 months = 2026-03-31` (no drift through February).
pub fn add_months_clamped(base: NaiveDate, months: i32) -> NaiveDate {
    let total = base.year() * 12 + (base.month() as i32 - 1) + months;
    let year = total.div_euclid(12);
    let month = (total.rem_euclid(12) + 1) as u32;
    let day = base.day().min(last_day_of_month(year, month));
    NaiveDate::from_ymd_opt(year, month, day).expect("clamped day is always valid")
}

/// Advance `stored` (the current `next_billing_on`) past a payment made on
/// `pay_date`.
///
/// - `None` (never billed) → pay date plus one calendar month, clamped.
/// - Otherwise → the first `add_months_clamped(stored, k)` (k = 1, 2, …)
///   strictly after `max(pay_date, stored)`, so an early payment still
///   counts for its cycle while a long-dormant subscription jumps to the
///   next future occurrence instead of one month into the past.
pub fn advance_next_billing(stored: Option<NaiveDate>, pay_date: NaiveDate) -> NaiveDate {
    let Some(stored) = stored else {
        return add_months_clamped(pay_date, 1);
    };
    let threshold = pay_date.max(stored);
    for k in 1..=MAX_CATCH_UP_MONTHS {
        let candidate = add_months_clamped(stored, k);
        if candidate > threshold {
            return candidate;
        }
    }
    add_months_clamped(pay_date, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn bogota_today_applies_fixed_minus_five_offset() {
        // 02:00 UTC is still "yesterday" in Bogota.
        let now = DateTime::parse_from_rfc3339("2026-09-24T02:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(today_bogota_at(now), date(2026, 9, 23));
        // 05:00 UTC is midnight in Bogota: the date flips.
        let now = DateTime::parse_from_rfc3339("2026-09-24T05:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(today_bogota_at(now), date(2026, 9, 24));
    }

    #[test]
    fn add_months_clamps_without_drift() {
        assert_eq!(
            add_months_clamped(date(2026, 1, 31), 1),
            date(2026, 2, 28)
        );
        assert_eq!(
            add_months_clamped(date(2026, 1, 31), 2),
            date(2026, 3, 31)
        );
        assert_eq!(
            add_months_clamped(date(2024, 1, 31), 1),
            date(2024, 2, 29)
        );
    }

    #[test]
    fn due_date_arrival_advances_one_month() {
        // Paid on the due date: next occurrence is one month later.
        assert_eq!(
            advance_next_billing(Some(date(2026, 10, 15)), date(2026, 10, 15)),
            date(2026, 11, 15)
        );
    }

    #[test]
    fn early_payment_counts_for_the_cycle() {
        // Due 2026-09-15, paid 2026-09-10: the threshold is the stored due
        // date, so the next billing is 2026-10-15 (still > today 2026-09-24,
        // reads paid, second pay blocked).
        assert_eq!(
            advance_next_billing(Some(date(2026, 9, 15)), date(2026, 9, 10)),
            date(2026, 10, 15)
        );
    }

    #[test]
    fn month_end_clamps_to_last_valid_day() {
        assert_eq!(
            advance_next_billing(Some(date(2026, 1, 31)), date(2026, 1, 31)),
            date(2026, 2, 28)
        );
        assert_eq!(
            advance_next_billing(Some(date(2024, 1, 31)), date(2024, 1, 31)),
            date(2024, 2, 29)
        );
    }

    #[test]
    fn long_dormant_jumps_to_next_future_occurrence() {
        assert_eq!(
            advance_next_billing(Some(date(2026, 4, 15)), date(2026, 9, 24)),
            date(2026, 10, 15)
        );
    }

    #[test]
    fn null_due_is_set_to_pay_plus_one_month() {
        assert_eq!(
            advance_next_billing(None, date(2026, 9, 24)),
            date(2026, 10, 24)
        );
        assert_eq!(
            advance_next_billing(None, date(2026, 1, 31)),
            date(2026, 2, 28)
        );
    }
}
