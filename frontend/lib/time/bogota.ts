/**
 * The application's single business timezone.
 *
 * Every "today", date block and wall-clock timestamp the UI derives is
 * expressed in America/Bogota, never in the viewer's zone: the owner reads the
 * dashboard from Bogotá, the backend binds the same calendar day into its
 * queries (`finance::dates::today_bogota()`), and habit logs are stored per
 * Bogotá day. Colombia has had no DST since 1993, so this is a fixed UTC-05:00
 * offset, but the zone NAME is what keeps `Intl` exact at the day boundary.
 *
 * One constant, one place: a bare `"America/Bogota"` string repeated per module
 * is exactly how a formatter drifts out of sync with the rest of the app.
 */
export const BOGOTA_TZ = "America/Bogota";
