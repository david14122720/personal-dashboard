"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ReportsScreensShell } from "@/components/containers/ReportsScreens";
import { getToken } from "@/lib/api/client";

export default function ReportesPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <ReportsScreensShell />;
}
