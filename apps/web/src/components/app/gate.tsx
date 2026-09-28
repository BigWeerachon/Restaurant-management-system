"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Logo } from "./app-shell";
import { useSabai } from "@/lib/demo/store";

/** Waits for local data to load, then requires a signed-in member. */
export function Gate({ children }: { children: ReactNode }) {
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !memberId) router.replace("/");
  }, [hydrated, memberId, router]);

  if (!hydrated || !memberId) return <Splash />;
  return <>{children}</>;
}

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" aria-busy="true" aria-live="polite">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <Logo />
        <div className="h-1 w-32 overflow-hidden rounded-full bg-surface-3">
          <div className="skeleton h-full w-full" />
        </div>
        <span className="sr-only">กำลังโหลด</span>
      </div>
    </div>
  );
}
