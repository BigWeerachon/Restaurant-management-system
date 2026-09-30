"use client";

import { ApiBoot } from "./api-boot";
import { OfflineBridge } from "./offline-bridge";
import { RealtimeBridge } from "./realtime-bridge";

/**
 * Everything that exists only when the app talks to a server — the shop refresh after a reload, the live line, the offline
 * queue's replay — in one download that `providers.tsx` fetches in API mode alone. The demo, which keeps everything on the
 * device, never asks for it.
 */
export default function ApiBridges() {
  return (
    <>
      <ApiBoot />
      <RealtimeBridge />
      <OfflineBridge />
    </>
  );
}
