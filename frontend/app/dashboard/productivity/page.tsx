"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ProductivityScreensShell } from "@/components/containers/ProductivityScreens";
import { getToken } from "@/lib/api/client";

export default function ProductivityPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return <ProductivityScreensShell />;
}
