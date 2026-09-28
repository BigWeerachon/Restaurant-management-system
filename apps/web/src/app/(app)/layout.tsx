"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Gate } from "@/components/app/gate";

export default function BackOfficeLayout({ children }: { children: ReactNode }) {
  return (
    <Gate>
      <AppShell>{children}</AppShell>
    </Gate>
  );
}
