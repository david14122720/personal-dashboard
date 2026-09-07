"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHomeShell } from "@/components/containers/DashboardHome";
import { getToken } from "@/lib/api/client";

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <DashboardHomeShell />;
}
