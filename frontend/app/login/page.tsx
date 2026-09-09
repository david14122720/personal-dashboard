"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, login } from "@/lib/api/client";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <main className="flex min-h-screen items-center justify-center bg-deck px-4 text-instrument">
      <section
        aria-labelledby="login-heading"
        className="w-full max-w-sm rounded-xl border border-hull bg-hull/40 p-6 shadow-lg"
      >
        <h1 id="login-heading" className="font-display text-2xl font-semibold tracking-wide">
          Control <span className="text-signal">Deck</span>
        </h1>
        <p className="mt-1 text-sm text-instrument/70">{t("login.subtitle")}</p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("login.email")}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-hull bg-deck px-3 py-2 text-instrument placeholder:text-instrument/40"
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("login.password")}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-hull bg-deck px-3 py-2 text-instrument placeholder:text-instrument/40"
              placeholder="••••••••"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-md border border-alert/50 px-3 py-2 text-sm text-alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-signal px-3 py-2 font-display text-sm font-semibold tracking-wide text-deck transition-opacity disabled:opacity-60"
          >
            {pending ? t("login.pending") : t("login.submit")}
          </button>
        </form>
      </section>
    </main>
  );
}
