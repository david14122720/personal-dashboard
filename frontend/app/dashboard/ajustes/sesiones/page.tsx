"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import SettingsScreen from "@/components/settings/SettingsScreen";
import { getToken } from "@/lib/api/client";

/** The unified Ajustes hub; this route opens the sessions tab. */
export default function SessionsPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <SettingsScreen active="sessions" />;
}
