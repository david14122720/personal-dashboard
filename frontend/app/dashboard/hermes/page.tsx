"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import HermesChat from "@/components/hermes/HermesChat";
import { getToken } from "@/lib/api/client";

/** Hermes chat: the agent keeps conversation memory server-side. */
export default function HermesPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return (
    <AppShell fill>
      <HermesChat />
    </AppShell>
  );
}
