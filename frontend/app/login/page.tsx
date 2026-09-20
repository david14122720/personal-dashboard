"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, login } from "@/lib/api/client";
import { t } from "@/lib/i18n";

// Display face for this screen: `font-deck-display` (Plus Jakarta Sans via
// next/font in the root layout, system fallback in globals.css).
// No global theme change, no CDN.

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="4" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 7l6 4 6-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="8.5" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 8.5V6.8a3.5 3.5 0 017 0v1.7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="12.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2.5 10S5.5 5.5 10 5.5 17.5 10 17.5 10 14.5 14.5 10 14.5 2.5 10 2.5 10z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2.5 10S5.5 5.5 10 5.5c1.5 0 2.9.5 4 1.2M14.5 12.7c-.6.5-1.5 1.2-2.6 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M4 4l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 10h12M11 5.5L15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" fill="currentColor" opacity="0.95" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" fill="currentColor" opacity="0.65" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" fill="currentColor" opacity="0.65" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="3.5" fill="currentColor" opacity="0.95" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.3-6 8-3.4-1.7-6-4-6-8V5l6-2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L12.8 8.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard/");
    }
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      router.replace("/dashboard/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error"));
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-slate-800/70 py-2.5 pl-10 pr-10 text-sm text-slate-100 placeholder:text-slate-500 transition-colors focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25";

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f19] px-4 py-12 text-slate-100"
      style={{ colorScheme: "dark" }}
    >
      {/* Ambient background: two radial glows + subtle grid. Decorative only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-96 w-[42rem] max-w-none -translate-x-1/2 rounded-full bg-[#006edc]/10 blur-[120px]" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-sky-400/10 blur-[100px]" />
        <div className="bg-grid-pattern absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_40%,black,transparent)]" />
      </div>

      <div className="relative w-full max-w-md">
        <section
          aria-labelledby="login-heading"
          className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-9"
        >
          {/* Top glow line */}
          <div aria-hidden="true" className="absolute inset-x-8 top-0 h-[2px] bg-gradient-to-r from-transparent via-signal to-transparent" />

          <div className="flex flex-col items-center text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#006edc] to-[#38bdf8] ring-1 ring-white/20">
              <DeckGlyph className="h-5 w-5 text-white" />
            </span>
            <h1 id="login-heading" className="font-deck-display mt-4 text-2xl font-bold tracking-tight">
              Control{" "}
              <span className="bg-gradient-to-r from-sky-400 to-[#006edc] bg-clip-text text-transparent">
                Deck
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">{t("login.subtitle")}</p>
          </div>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="login-email"
                className="text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                {t("login.email")}
              </label>
              <div className="relative">
                <MailIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="login-password"
                className="text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                {t("login.password")}
              </label>
              <div className="relative">
                <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition-colors hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-signal"
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-[18px] w-[18px]" />
                  ) : (
                    <EyeIcon className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2 text-slate-300">
                <input
                  id="login-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-800 accent-[#006edc]"
                />
                {t("login.remember")}
              </label>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="font-medium text-sky-400 transition-colors hover:text-sky-300"
              >
                {t("login.forgot")}
              </a>
            </div>

            {error ? (
              <p role="alert" className="rounded-xl border border-alert/50 bg-alert/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#006edc] to-[#0088ff] px-3 py-2.5 font-display text-sm font-semibold tracking-wide text-white shadow-lg shadow-[#006edc]/25 transition-all hover:from-[#006edc] hover:to-[#38bdf8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.99] disabled:opacity-60"
            >
              {pending ? t("login.pending") : t("login.submit")}
              <ArrowIcon className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-7 flex items-center justify-center gap-2 border-t border-white/10 pt-5 text-xs text-slate-500">
            <ShieldIcon className="h-4 w-4 text-slate-500" />
            <span>{t("login.secureNote")}</span>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-slate-600">{t("login.footerNote")}</p>
      </div>
    </main>
  );
}
