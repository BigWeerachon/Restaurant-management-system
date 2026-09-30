"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { installAuthRenewer, recoverFromUnauthorized } from "@/lib/auth/session";
import { dataSourceMode } from "@/lib/data-source/config";
import { getApiSession } from "@/lib/data-source/http-client";
import { loadShop } from "@/lib/data-source/http-data-source";
import { isDomainError, useSabai } from "@/lib/demo/store";

/** API mode only: refreshes the shop from the server after a reload, and sends people back to the start when their session has expired. */
export function ApiBoot() {
  const hydrated = useSabai((s) => s.hydrated);
  const signOut = useSabai((s) => s.signOut);
  const router = useRouter();

  // From now on the HTTP client renews the account's token when it is about to run out, or when the server says it has.
  useEffect(() => {
    if (dataSourceMode() === "api") installAuthRenewer();
  }, []);

  useEffect(() => {
    if (dataSourceMode() !== "api" || !hydrated) return;
    const { token, tenantId } = getApiSession();
    if (!token || !tenantId) return;
    loadShop({ reset: false }).catch((e) => {
      if (isDomainError(e) && e.code === "AUTH_REQUIRED") {
        void recoverFromUnauthorized().then(() => {
          signOut();
          router.replace("/");
        });
      }
    });
  }, [hydrated, signOut, router]);

  return null;
}
