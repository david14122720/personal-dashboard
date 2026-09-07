use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::helper::require_user_id, auth::middleware, error::AppError, state::AppState};

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub preferences: Preferences,
}

#[derive(Debug, Serialize)]
pub struct Preferences {
    pub currency_code: String,
    pub locale: String,
    pub timezone: String,
    pub dashboard_layout: serde_json::Value,
}

pub async fn me_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let hash = middleware::bearer_hash(&token);

    // Join sessions -> users -> user_preferences, only active session
    let row = sqlx::query_as::<_, (Uuid, String, String, Option<String>, Option<String>, Option<String>, Option<serde_json::Value>)>(
        r#"SELECT u.id, u.email, u.display_name,
                  p.currency_code, p.locale, p.timezone, p.dashboard_layout
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN user_preferences p ON p.user_id = u.id
           WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()"#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    let Some((id, email, display_name, currency, locale, timezone, layout)) = row else {
        return Err(AppError::Auth);
    };

    Ok(Json(MeResponse {
        id,
        email,
        display_name,
        preferences: Preferences {
            currency_code: currency.unwrap_or_else(|| "COP".into()),
            locale: locale.unwrap_or_else(|| "es-CO".into()),
            timezone: timezone.unwrap_or_else(|| "America/Bogota".into()),
            dashboard_layout: layout.unwrap_or(serde_json::json!({})),
        },
    }))
}

/// Partial preferences update: only supplied fields change, omitted fields
/// stay put, and the merged row is returned. Every supplied value is
/// validated BEFORE any write, so a 422 leaves the row untouched.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchPreferencesRequest {
    pub currency_code: Option<String>,
    pub locale: Option<String>,
    pub timezone: Option<String>,
    pub dashboard_layout: Option<serde_json::Value>,
}

/// Static ISO-4217 allowlist of common currency codes: `^[A-Z]{3}$` shape
/// alone is not enough — unknown codes (e.g. `"XYZ"`) are 422.
pub const ISO_4217_CURRENCIES: &[&str] = &[
    "USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "CNY", "HKD", "SGD", "NZD", "SEK", "NOK",
    "DKK", "PLN", "CZK", "HUF", "ILS", "MXN", "BRL", "ARS", "CLP", "COP", "PEN", "UYU", "BOB",
    "DOP", "GTQ", "CRC", "PAB", "JMD", "TTD", "XCD", "QAR", "SAR", "AED", "KWD", "EGP", "NGN",
    "KES", "GHS", "ZAR", "INR", "PKR", "BDT", "LKR", "THB", "VND", "IDR", "MYR", "PHP", "KRW",
    "TWD", "TRY", "UAH",
];

/// `^[A-Z]{3}$` AND allowlist membership, else 422.
pub fn validate_currency_code(raw: &str) -> Result<String, AppError> {
    let value = raw.trim();
    let well_formed = value.len() == 3 && value.bytes().all(|b| b.is_ascii_uppercase());
    if !well_formed || !ISO_4217_CURRENCIES.contains(&value) {
        return Err(AppError::Validation(
            "currency_code must be a known ISO-4217 code".into(),
        ));
    }
    Ok(value.to_string())
}

/// `^[a-z]{2}(-[A-Z]{2})?$` (e.g. `"es"`, `"es-CO"`), else 422.
pub fn validate_locale(raw: &str) -> Result<String, AppError> {
    let value = raw.trim();
    let bytes = value.as_bytes();
    let ok = value.len() == 2 && bytes.iter().all(|b| b.is_ascii_lowercase())
        || value.len() == 5
            && bytes[2] == b'-'
            && bytes[..2].iter().all(|b| b.is_ascii_lowercase())
            && bytes[3..].iter().all(|b| b.is_ascii_uppercase());
    if !ok {
        return Err(AppError::Validation(
            "locale must match ll or ll-CC (e.g. es-CO)".into(),
        ));
    }
    Ok(value.to_string())
}

/// Widget kinds and sizes accepted in `dashboard_layout` (design-decided
/// schema); unknown object keys are 422 via `deny_unknown_fields`.
pub const WIDGET_TYPES: &[&str] = &["metric", "chart", "list", "ledger", "heatmap"];
pub const WIDGET_SIZES: &[&str] = &["sm", "md", "lg"];
pub const MAX_WIDGETS: usize = 32;
pub const MAX_WIDGET_ID_LEN: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DashboardLayoutPayload {
    widgets: Vec<WidgetPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WidgetPayload {
    id: String,
    #[serde(rename = "type")]
    widget_type: String,
    order: i64,
    size: String,
}

/// Validate `dashboard_layout` against `{ widgets: [{ id, type, order, size }] }`:
/// `widgets` ≤ 32, `id` 1–64 chars, `type`/`size` from the allowlists,
/// `order` ≥ 0. Unknown keys → 422. Returns nothing; the original value is
/// stored verbatim once valid.
pub fn validate_dashboard_layout(value: &serde_json::Value) -> Result<(), AppError> {
    let layout: DashboardLayoutPayload = serde_json::from_value(value.clone()).map_err(|_| {
        AppError::Validation("dashboard_layout has an unknown field or wrong shape".into())
    })?;
    if layout.widgets.len() > MAX_WIDGETS {
        return Err(AppError::Validation(format!(
            "dashboard_layout.widgets must have at most {MAX_WIDGETS} entries"
        )));
    }
    for widget in &layout.widgets {
        let id = widget.id.trim();
        if id.is_empty() || id.len() > MAX_WIDGET_ID_LEN {
            return Err(AppError::Validation(
                "dashboard_layout widget id must be 1-64 characters".into(),
            ));
        }
        if !WIDGET_TYPES.contains(&widget.widget_type.as_str()) {
            return Err(AppError::Validation(
                "dashboard_layout widget type must be one of: metric, chart, list, ledger, heatmap"
                    .into(),
            ));
        }
        if widget.order < 0 {
            return Err(AppError::Validation(
                "dashboard_layout widget order must be >= 0".into(),
            ));
        }
        if !WIDGET_SIZES.contains(&widget.size.as_str()) {
            return Err(AppError::Validation(
                "dashboard_layout widget size must be one of: sm, md, lg".into(),
            ));
        }
    }
    Ok(())
}

const ENSURE_PREFS_SQL: &str =
    "INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING";
const PATCH_PREFS_SQL: &str = "UPDATE user_preferences SET currency_code=COALESCE($2,currency_code), locale=COALESCE($3,locale), timezone=COALESCE($4,timezone), dashboard_layout=COALESCE($5,dashboard_layout), updated_at=now() WHERE user_id=$1 RETURNING currency_code, locale, timezone, dashboard_layout";
const TIMEZONE_EXISTS_SQL: &str = "SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)";

pub async fn patch_preferences_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PatchPreferencesRequest>,
) -> Result<Json<Preferences>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    if body.currency_code.is_none()
        && body.locale.is_none()
        && body.timezone.is_none()
        && body.dashboard_layout.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    // Validate everything BEFORE any write: a 422 writes nothing.
    let currency = body
        .currency_code
        .as_deref()
        .map(validate_currency_code)
        .transpose()?;
    let locale = body.locale.as_deref().map(validate_locale).transpose()?;
    let timezone = match body.timezone.as_deref() {
        None => None,
        Some(raw) => {
            let value = raw.trim().to_string();
            let exists: bool = sqlx::query_scalar(TIMEZONE_EXISTS_SQL)
                .bind(&value)
                .fetch_one(&state.pool)
                .await
                .map_err(|_| AppError::Internal)?;
            if !exists {
                return Err(AppError::Validation(
                    "timezone must be a known IANA time zone name".into(),
                ));
            }
            Some(value)
        }
    };
    if let Some(layout) = body.dashboard_layout.as_ref() {
        validate_dashboard_layout(layout)?;
    }
    sqlx::query(ENSURE_PREFS_SQL)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    let row = sqlx::query_as::<_, (String, String, String, serde_json::Value)>(PATCH_PREFS_SQL)
        .bind(user_id)
        .bind(currency)
        .bind(locale)
        .bind(timezone)
        .bind(body.dashboard_layout)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(Preferences {
        currency_code: row.0,
        locale: row.1,
        timezone: row.2,
        dashboard_layout: row.3,
    }))
}

#[cfg(test)]
mod preferences_tests {
    use super::*;
    use axum::http::HeaderMap;
    use axum::response::IntoResponse;
    use serde_json::json;

    fn assert_401(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    fn lazy_state() -> AppState {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(LoginRateLimiter::new()),
        }
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("prefs-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("prefs test")
        .fetch_one(pool)
        .await
        .expect("seed user");
        let raw = crate::auth::tokens::generate_token();
        let hash = crate::auth::tokens::hash_token(&raw);
        sqlx::query(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval '1 hour')",
        )
        .bind(user_id)
        .bind(&hash)
        .execute(pool)
        .await
        .expect("seed session");
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(LoginRateLimiter::new()),
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {raw}").parse().unwrap(),
        );
        (state, headers, user_id)
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    fn patch_body(value: serde_json::Value) -> axum::Json<PatchPreferencesRequest> {
        axum::Json(serde_json::from_value(value).expect("valid patch envelope"))
    }

    // -- Task 0.11 RED: preferences PATCH does not exist yet --

    #[test]
    fn currency_code_requires_iso_4217_allowlist() {
        for raw in ["COP", "USD", "EUR", "JPY"] {
            assert_eq!(validate_currency_code(raw).unwrap(), raw);
        }
        // Unknown codes, wrong case, wrong length, blanks: all 422.
        for raw in ["XYZ", "usd", "US", "USDD", "", "   ", "U5D", "XXX"] {
            assert_422(validate_currency_code(raw).unwrap_err());
        }
    }

    #[test]
    fn locale_requires_ll_or_ll_cc_shape() {
        for raw in ["es-CO", "en-US", "en", "es"] {
            assert_eq!(validate_locale(raw).unwrap(), raw);
        }
        for raw in ["", "e", "english", "es_co", "ES-co", "es-C0", "es-CO-EXTRA"] {
            assert_422(validate_locale(raw).unwrap_err());
        }
    }

    #[test]
    fn dashboard_layout_enforces_widget_schema() {
        let ok = json!({"widgets": [{"id": "monthly-flow", "type": "chart", "order": 0, "size": "lg"}]});
        validate_dashboard_layout(&ok).unwrap();
        validate_dashboard_layout(&json!({"widgets": []})).unwrap();
        // Unknown top-level or widget keys are 422 (deny_unknown_fields).
        let unknown_top = json!({"widgets": [], "theme": "dark"});
        assert_422(validate_dashboard_layout(&unknown_top).unwrap_err());
        let unknown_widget_key = json!({"widgets": [{"id": "a", "type": "chart", "order": 0, "size": "lg", "bogus": 1}]});
        assert_422(validate_dashboard_layout(&unknown_widget_key).unwrap_err());
        // Bad enum values, negative order, oversized id, oversized list.
        for bad in [
            json!({"widgets": [{"id": "a", "type": "pie", "order": 0, "size": "lg"}]}),
            json!({"widgets": [{"id": "a", "type": "chart", "order": -1, "size": "lg"}]}),
            json!({"widgets": [{"id": "a", "type": "chart", "order": 0, "size": "xl"}]}),
            json!({"widgets": [{"id": "", "type": "chart", "order": 0, "size": "lg"}]}),
            json!({"widgets": [{"id": "x".repeat(65), "type": "chart", "order": 0, "size": "lg"}]}),
        ] {
            assert_422(validate_dashboard_layout(&bad).unwrap_err());
        }
        let many: Vec<serde_json::Value> = (0..33)
            .map(|i| json!({"id": format!("w-{i}"), "type": "metric", "order": i, "size": "sm"}))
            .collect();
        assert_422(validate_dashboard_layout(&json!({"widgets": many})).unwrap_err());
    }

    #[tokio::test]
    async fn unauthenticated_patch_is_401() {
        let err = patch_preferences_handler(
            State(lazy_state()),
            HeaderMap::new(),
            patch_body(json!({"currency_code": "USD"})),
        )
        .await
        .expect_err("missing session must be 401");
        assert_401(err);
    }

    #[tokio::test]
    async fn partial_update_merges_and_preserves_omitted_fields() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP partial_update_merges_and_preserves_omitted_fields: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let layout = json!({"widgets": [{"id": "monthly-flow", "type": "chart", "order": 0, "size": "lg"}]});
        let body = patch_preferences_handler(
            State(state.clone()),
            headers.clone(),
            patch_body(json!({"currency_code": "USD", "dashboard_layout": layout})),
        )
        .await
        .expect("partial update is 200")
        .0;
        assert_eq!(body.currency_code, "USD");
        assert_eq!(body.dashboard_layout, layout);
        // Omitted fields stay unchanged: locale keeps its default.
        assert_eq!(body.locale, "es-CO");
        // A second partial update preserves the layout.
        let body = patch_preferences_handler(
            State(state.clone()),
            headers.clone(),
            patch_body(json!({"locale": "en-US"})),
        )
        .await
        .expect("second update is 200")
        .0;
        assert_eq!(body.locale, "en-US");
        assert_eq!(body.currency_code, "USD");
        assert_eq!(body.dashboard_layout, layout);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn invalid_values_are_422_and_write_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP invalid_values_are_422_and_write_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for bad in [
            json!({"currency_code": "XYZ"}),
            json!({"timezone": "Not/AZone"}),
            json!({"locale": "es_co"}),
            json!({"dashboard_layout": {"widgets": [{"id": "a", "type": "nope", "order": 0, "size": "lg"}]}}),
            json!({}),
        ] {
            let err = patch_preferences_handler(State(state.clone()), headers.clone(), patch_body(bad))
                .await
                .expect_err("invalid preferences must be 422");
            assert_422(err);
        }
        // Nothing was written: defaults are intact.
        let me = me_handler(State(state.clone()), headers.clone())
            .await
            .expect("me is 200")
            .0;
        assert_eq!(me.preferences.currency_code, "COP");
        assert_eq!(me.preferences.locale, "es-CO");
        cleanup_user(&pool, user_id).await;
    }
}
