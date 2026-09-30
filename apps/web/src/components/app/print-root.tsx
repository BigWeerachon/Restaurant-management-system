"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { usePrintJob } from "@/lib/print";

/** The receipt view, the tax invoice, their layout and the printer's encoder: fetched when the first job arrives (see `warmPrintJob`). */
const loadPrintJob = () => import("./print-job");
const PrintJob = dynamic(loadPrintJob, { ssr: false });

/** How long after the till opens before the print code is fetched in the background: past the first paint, never in its way. */
const WARM_AFTER_MS = 3000;

/**
 * Where paper output is drawn — `print-job.tsx` — but only once there is something to print. The code for it is fetched a
 * few seconds after the screen has settled, so the first receipt is not held up by a download, and so a till that lost its
 * line since still has it (the service worker keeps every file the page has fetched).
 */
export function PrintRoot() {
  const job = usePrintJob((s) => s.job);
  useEffect(() => {
    const id = setTimeout(() => void loadPrintJob().catch(() => undefined), WARM_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  return job ? <PrintJob /> : null;
}
