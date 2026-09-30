"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Gate, RouteGuard } from "@/components/app/gate";

export default function BackOfficeLayout({ children }: { children: ReactNode }) {
  return (
    <Gate>
      <AppShell>
        <RouteGuard>{children}</RouteGuard>
      </AppShell>
    </Gate>
  );
}
