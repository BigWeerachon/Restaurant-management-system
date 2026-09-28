"use client";

import { routeAllowed } from "@sabai/domain";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import NoAccessPage from "@/app/(app)/no-access/page";
import { useAccess } from "@/hooks/use-sabai";
import { useSabai } from "@/lib/demo/store";
import { Logo } from "./app-shell";

/**
 * Waits for local data to load, then requires a signed-in member who may open
 * this path. A blocked deep link explains itself instead of a blank page.
 */
export function Gate({ children }: { children: ReactNode }) {
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const router = useRouter();
  const pathname = usePathname();
  const { access, member } = useAccess();

  const signOut = useSabai((s) => s.signOut);
  const signedIn = !!member?.active;

  useEffect(() => {
    if (!hydrated || signedIn) return;
    // Covers a member deactivated or removed while signed in on this device.
    if (memberId) signOut();
    router.replace("/");
  }, [hydrated, signedIn, memberId, signOut, router]);

  if (!hydrated || !signedIn) return <Splash />;
  if (!routeAllowed(access, pathname)) return <NoAccessPage />;
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
