import { t } from "@/lib/i18n";

export default function WidgetToggle({ id, visible, onToggle }: { id: string; visible: boolean; onToggle: (next: boolean) => void }) {
  const label = visible ? t("dashboard.widgetHide") : t("dashboard.widgetShow");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      aria-label={`${label}: ${id}`}
      onClick={() => onToggle(!visible)}
      className="rounded-md border border-hull px-2 py-1 font-display text-xs text-instrument/70 transition-colors hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-signal"
    >
      {label}
    </button>
  );
}
