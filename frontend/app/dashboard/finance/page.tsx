"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FinanceScreensShell } from "@/components/containers/FinanceScreens";
import { getToken } from "@/lib/api/client";

export default function FinancePage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <FinanceScreensShell />;
}
