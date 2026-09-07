"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api/client";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/dashboard/" : "/login/");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-deck text-instrument">
      <p className="font-mono text-sm opacity-70">Loading…</p>
    </main>
  );
}
