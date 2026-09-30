/**
 * The doors into `client-errors.ts` for the parts of the page that load first. The tracker's code (and the SDK behind it)
 * is a download of its own that is fetched only when a tracker is configured (`NEXT_PUBLIC_ERROR_TRACKING_DSN`): the public
 * demo runs without one, and carries none of it.
 */
export const errorTrackingOn = (): boolean => !!process.env.NEXT_PUBLIC_ERROR_TRACKING_DSN;

/** Reports an error caught by a page's error boundary. Never throws: a failed report must not make a failed page worse. */
export function reportBoundaryError(error: unknown, digest?: string): void {
  if (!errorTrackingOn()) return;
  void import("./client-errors").then((m) => m.reportClientError(error, "boundary", { digest })).catch(() => undefined);
}

/** Starts watching for errors nothing else caught. Returns the undo, usable before the code has arrived. */
export function watchForErrors(): () => void {
  if (!errorTrackingOn()) return () => undefined;
  let undo: (() => void) | undefined;
  let cancelled = false;
  void import("./client-errors")
    .then((m) => {
      if (!cancelled) undo = m.installGlobalErrorHandlers();
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    undo?.();
  };
}
