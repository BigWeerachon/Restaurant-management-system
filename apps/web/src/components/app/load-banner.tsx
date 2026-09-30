"use client";

import { humanizeError } from "@sabai/domain";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/primitives";
import type { LoadState } from "@/hooks/use-data-source";
import { isDomainError } from "@/lib/demo/store";

/**
 * API mode: says when the latest data is still loading (a bar that takes no room), or why it could not load, with a retry.
 * Renders nothing in demo mode. `className` is for the error message, an inline callout; the bar is fixed to the window.
 */
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
    // A thin bar along the top edge of the window, and the same words for a screen reader. It is not a line of text in the
    // page: that took 30–40 px which vanished when the data arrived, and everything below it jumped (on every page, and three
    // times over on the kitchen screen).
    return (
      <>
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden bg-brand/10">
          <div className="loading-bar h-full w-full" />
        </div>
        <p role="status" className="sr-only">
          กำลังโหลดข้อมูลล่าสุด…
        </p>
      </>
    );
  }
  return null;
}
