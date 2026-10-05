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
      className="inline-flex min-h-9 items-center justify-center rounded-md border border-hull px-3 text-xs transition-colors hover:border-signal hover:text-signal"
    >
      {label}
    </button>
  );
}
