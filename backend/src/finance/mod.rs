//! Finance domain foundation (money handling, shared validation).
//!
//! Shared parsers and validation helpers live here so route modules stay
//! thin and the S1–S3 removal slices keep a surviving home for behaviour
//! every finance write depends on.

pub mod money;
pub mod validation;
