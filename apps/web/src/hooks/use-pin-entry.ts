"use client";

import { useCallback, useState } from "react";

/**
 * State and key handling shared by every PIN keypad (switch user, approval,
 * device sign-in, connect): digits fill up to `length`, any new key clears the
 * last error, and the PIN is handed to `onComplete` a beat after the last dot
 * fills so the user sees it land.
 */
export function usePinEntry(onComplete: (pin: string) => void, length = 4) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onKey = (k: string) => {
    if (pin.length >= length) return;
    const next = pin + k;
    setError(null);
    setPin(next);
    if (next.length === length) setTimeout(() => onComplete(next), 120);
  };

  const reset = useCallback(() => {
    setPin("");
    setError(null);
  }, []);

  /** Props for `<Keypad>`. */
  const keypad = { onKey, onBackspace: () => setPin((p) => p.slice(0, -1)), onClear: () => setPin("") };

  return { pin, setPin, error, setError, reset, keypad };
}
