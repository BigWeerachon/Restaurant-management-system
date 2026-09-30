"use client";

import { useEffect } from "react";
import { installGlobalErrorHandlers } from "@/lib/observability/client-errors";

/** Watches the page for errors nothing else caught, and hands them to the error tracker (if there is one). Shows nothing. */
export function ErrorReporting() {
  useEffect(() => installGlobalErrorHandlers(), []);
  return null;
}
