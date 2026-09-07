"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getToken } from "@/lib/api/client";

function PlaceholderCard({ title, hint }: { title: string; hint: string }) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-hull bg-hull/40 p-5"
    >
      <h2 className="font-display text-base font-semibold tracking-wide">{title}</h2>
      <p className="mt-1 text-sm text-instrument/60">{hint}</p>
    </section>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login/");
    }
  }, [router]);

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold tracking-wide">Overview</h1>
      <p className="mt-1 text-sm text-instrument/60">
        Telemetry strip and charts land in Slice 2. This shell proves the session guard and layout.
      </p>
      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <PlaceholderCard title="Telemetry" hint="Slice 2: TelemetryStrip with LED mapping." />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <PlaceholderCard title="Monthly flow" hint="Slice 2: FlowChart from aggregates." />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <PlaceholderCard title="Categories" hint="Slice 2: CategoryDonut from aggregates." />
        </div>
      </div>
    </AppShell>
  );
}
