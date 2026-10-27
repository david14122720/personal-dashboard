"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import SettingsScreen from "@/components/settings/SettingsScreen";
import { getToken } from "@/lib/api/client";

/** The unified Ajustes hub; this route opens the general tab. */
export default function AjustesPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <SettingsScreen active="general" />;
}
