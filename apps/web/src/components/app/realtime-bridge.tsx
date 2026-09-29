"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { dataSourceMode } from "@/lib/data-source/config";
import { recoverFromUnauthorized } from "@/lib/auth/session";
import { refresh } from "@/lib/data-source/http-context";
import { activeSlices, createRefresher, startRealtime } from "@/lib/data-source/realtime";
import { useSabai } from "@/lib/demo/store";

/**
 * API mode only: keeps the branch's live event stream open while someone is signed in, and reads again the
 * parts of the store an event makes stale — when a screen is showing them. Nothing to see here; the screens
 * simply stay current (and `useRealtimeStatus` tells them whether the line is up).
 */
export function RealtimeBridge() {
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const branchId = useSabai((s) => s.session.branchId);
  const signOut = useSabai((s) => s.signOut);
  const router = useRouter();

  useEffect(() => {
    if (dataSourceMode() !== "api" || !hydrated || !memberId || !branchId) return;
    const refresher = createRefresher((slices) => refresh(slices));
    const stop = startRealtime({
      branchId,
      onStale: (slices) => refresher.ask(slices),
      onCatchUp: () => refresher.ask(activeSlices()),
      onUnauthorized: () => {
        void recoverFromUnauthorized().then(() => {
          signOut();
          router.replace("/");
        });
      },
    });
    return () => {
      stop();
      refresher.stop();
    };
  }, [hydrated, memberId, branchId, signOut, router]);

  return null;
}
