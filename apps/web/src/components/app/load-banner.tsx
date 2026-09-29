"use client";

import { humanizeError } from "@sabai/domain";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/primitives";
import type { LoadState } from "@/hooks/use-data-source";
import { isDomainError } from "@/lib/demo/store";

/** API mode: says when the latest data is still loading, or why it could not load, with a retry. Renders nothing in demo mode. */
export function LoadBanner({ state, className }: { state: LoadState; className?: string }) {
  if (state.error) {
    const h = humanizeError(isDomainError(state.error) ? state.error.code : "INTERNAL");
    // Losing the line is not a fault to alarm anyone about: what is on screen is what this device already knew.
    return (
      <Callout
        tone={h.code === "NETWORK_OFFLINE" ? "warning" : "danger"}
        title={h.title}
        className={className}
        action={
          <Button size="sm" variant="secondary" onClick={() => void state.reload()}>
            ลองอีกครั้ง
          </Button>
        }
      >
        {h.message}
      </Callout>
    );
  }
  if (state.loading) {
    return (
      <p role="status" className={className ?? "px-4 py-2 text-sm text-ink-3"}>
        กำลังโหลดข้อมูลล่าสุด…
      </p>
    );
  }
  return null;
}
