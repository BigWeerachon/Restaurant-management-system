"use client";

import { useEffect } from "react";
import { watchForErrors } from "@/lib/observability/report";

/** Watches the page for errors nothing else caught, and hands them to the error tracker (if there is one). Shows nothing. */
export function ErrorReporting() {
  useEffect(() => watchForErrors(), []);
  return null;
}
