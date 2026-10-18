pub mod accounts;
pub mod assets;
pub mod categories;
pub mod events;
pub mod goals;
pub mod habits;
pub mod health;
pub mod login;
pub mod logout;
pub mod me;
pub mod movements;
pub mod notes;
pub mod ready;
pub mod sessions;
pub mod subscriptions;
pub mod tasks;
pub mod tokens;

use crate::error::AppError;

/// Read shape of a list endpoint the SPA renders.
///
/// `?shape=brief` returns exactly the fields the browser view reads, so the
/// response carries no field the page cannot use (owner spec S6/S8, acceptance
/// criterion 3). The parameter is absent for every other consumer — the MCP
/// server passes each API response through to the agent — so that contract is
/// untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadShape {
    /// Every column the resource serializes (today's response).
    Full,
    /// Only the fields with a frontend read site, measured per endpoint.
    Brief,
}

impl ReadShape {
    pub fn is_brief(self) -> bool {
        matches!(self, ReadShape::Brief)
    }
}

/// Query struct for list endpoints that take nothing but the read shape.
///
/// Unknown query parameters stay ignored here, exactly as these endpoints
/// behaved before the shape existed: only the `shape` value itself is
/// validated by [`parse_read_shape`] (422). A caller that already appends a
/// stray parameter — a cache-buster, for instance — must not start failing.
#[derive(Debug, serde::Deserialize)]
pub struct ShapeQuery {
    pub shape: Option<String>,
}

/// Parse the `shape` query parameter. Absent means [`ReadShape::Full`]; any
/// value other than `brief` is a strict-read 422, never silently ignored.
pub fn parse_read_shape(raw: Option<&str>) -> Result<ReadShape, AppError> {
    match raw {
        None => Ok(ReadShape::Full),
        Some("brief") => Ok(ReadShape::Brief),
        Some(other) => Err(AppError::Validation(format!(
            "shape must be one of: brief (got `{other}`)"
        ))),
    }
}
