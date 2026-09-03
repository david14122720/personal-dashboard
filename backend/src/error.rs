use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;
use thiserror::Error;

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum AppError {
    #[error("unauthorized")]
    Auth,
    #[error("forbidden")]
    Forbidden,
    #[error("validation error")]
    Validation(String),
    #[error("not found")]
    NotFound,
    #[error("conflict")]
    Conflict(String),
    #[error("internal error")]
    Internal,
    #[error("database error")]
    Db,
    #[error("rate limited")]
    RateLimited(u64),
}

impl AppError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::Auth => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN"),
            Self::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR"),
            Self::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT"),
            Self::RateLimited(_) => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED"),
            Self::Internal | Self::Db => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
        }
    }

    fn message(&self) -> String {
        match self {
            Self::Validation(msg) | Self::Conflict(msg) => msg.clone(),
            Self::Auth => "Invalid credentials".to_string(),
            Self::Forbidden => "Forbidden".to_string(),
            Self::NotFound => "Not found".to_string(),
            Self::RateLimited(_) => "Too many requests".to_string(),
            Self::Internal | Self::Db => "Internal server error".to_string(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, code) = self.status_and_code();
        let retry = match self {
            Self::RateLimited(secs) => Some(secs),
            _ => None,
        };
        let body = Json(json!({
            "error": {
                "code": code,
                "message": self.message()
            }
        }));
        let mut resp = (status, body).into_response();
        if let Some(secs) = retry {
            resp.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from_str(&secs.to_string()).unwrap(),
            );
        }
        resp
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn auth_maps_to_401() {
        let resp = AppError::Auth.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn validation_maps_to_422() {
        let resp = AppError::Validation("bad".into()).into_response();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn internal_maps_to_500_with_generic_message() {
        let (status, code) = AppError::Internal.status_and_code();
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(code, "INTERNAL_ERROR");
        assert_eq!(AppError::Internal.message(), "Internal server error");
    }

    #[test]
    fn db_also_maps_to_500() {
        let (status, _) = AppError::Db.status_and_code();
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }
}
