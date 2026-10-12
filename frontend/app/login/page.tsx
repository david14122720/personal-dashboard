"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, login } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { deck } from "@/components/ui/deckStyles";

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

/** Brand hexagon (login-desktop.html:62-66), drawn in the repo icon style (D3). */
function HexagonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <polygon
        points="12 2 2 7 2 17 12 22 22 17 22 7 12 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="12" x2="12" y1="22" y2="15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <polyline
        points="22 7 12 12.5 2 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
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

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-deck px-4 py-12 text-slate-100"
      style={{ colorScheme: "dark" }}
    >
      {/* Ambient background: two radial glows + subtle grid. Decorative only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-96 w-[42rem] max-w-none -translate-x-1/2 rounded-full bg-[#006edc]/10 blur-[120px]" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-sky-400/10 blur-[100px]" />
        <div className="bg-grid-pattern absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_40%,black,transparent)]" />
      </div>

      <div className="relative w-full max-w-md">
        <section aria-labelledby="login-heading" className={deck.loginCard}>
          {/* Top glow line */}
          <div aria-hidden="true" className={deck.loginTopHairline} />

          <header className="text-left">
            <div className="mb-5 flex items-center justify-between">
              <span aria-hidden="true" className={deck.loginLogoTile}>
                <span className={deck.loginLogoGlow} />
                <HexagonIcon className="relative h-6 w-6 text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
              </span>
              <span role="status" className={deck.loginStatusPill}>
                <span aria-hidden="true" className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                {t("login.online")}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1
                id="login-heading"
                className="font-deck-display flex items-center gap-1.5 text-2xl font-bold tracking-tight sm:text-3xl"
              >
                Control{" "}
                <span className="bg-gradient-to-r from-sky-400 via-sky-300 to-cyan-200 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(56,189,248,0.35)]">
                  Deck
                </span>
              </h1>
              <span className={deck.loginVersionBadge}>{t("login.version")}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{t("login.subtitle")}</p>
          </header>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-5">
            <div>
              <label htmlFor="login-email" className={deck.loginFieldLabel}>
                {t("login.email")}
              </label>
              <div className="group relative mt-2">
                <span aria-hidden="true" className={deck.loginFieldIcon}>
                  <MailIcon className="h-[18px] w-[18px]" />
                </span>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`${deck.loginField} pl-10 pr-4`}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className={deck.loginFieldLabel}>
                {t("login.password")}
              </label>
              <div className="group relative mt-2">
                <span aria-hidden="true" className={deck.loginFieldIcon}>
                  <LockIcon className="h-[18px] w-[18px]" />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${deck.loginField} pl-10 pr-12`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  className={deck.loginEyeToggle}
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-[18px] w-[18px]" />
                  ) : (
                    <EyeIcon className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
            </div>

            {/* D10 (JD item 9): the prototype's `Recordar sesión` checkbox and
                `¿Olvidaste tu contraseña?` anchor are deliberately NOT rendered.
                Neither can be made real here: the session is a bearer token in
                localStorage with a server-side TTL, so a remember flag would be
                a state nobody reads, and the app has no password-recovery flow
                to send anyone to. The prototype's `Passkey` / `Token CLI`
                buttons and its footer links stay omitted for the same reason:
                a visible control must not claim behaviour the app lacks. */}
            {error ? (
              <p role="alert" className="rounded-xl border border-alert/50 bg-alert/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={pending} className={deck.loginCta}>
              <span aria-hidden="true" className={deck.loginCtaOverlay} />
              <span>{pending ? t("login.pending") : t("login.submit")}</span>
              <ArrowIcon className="h-[18px] w-[18px] motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-1" />
            </button>
          </form>

          <div className={deck.loginSecureNote}>
            <ShieldIcon className="h-4 w-4 shrink-0" />
            <span>{t("login.secureNote")}</span>
          </div>
        </section>

        <p className={deck.loginFooterNote}>{t("login.footerNote")}</p>
      </div>
    </main>
  );
}
