import { t } from "@/lib/i18n";

/**
 * Shared local section states for the Resumen blocks. Every block keeps its
 * own loading/error state (one failing read never blanks the page) and the
 * retry button revalidates only the SWR keys the caller owns.
 */

export function SectionSkeleton({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label ?? t("dashboard.loadingDashboard")}
      className="animate-pulse rounded-xl border border-hair bg-card p-5"
    >
      <div className="h-4 w-24 rounded bg-hair" />
    </div>
  );
}

export function SectionError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
      <p className="mt-1 text-sm text-instrument/70">
        {message ?? t("dashboard.sectionLoadFailed")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hair px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
