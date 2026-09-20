"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import HabitsDashboard from "@/components/habits/HabitsDashboard";
import { getToken } from "@/lib/api/client";

export default function HabitosPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return (
    <AppShell>
      <HabitsDashboard />
    </AppShell>
  );
}
