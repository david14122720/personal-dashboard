"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ProgressScreensShell } from "@/components/containers/ProgressScreens";
import { getToken } from "@/lib/api/client";

export default function ProgresoPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <ProgressScreensShell />;
}
