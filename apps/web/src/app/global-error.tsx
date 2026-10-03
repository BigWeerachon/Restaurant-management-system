"use client";

import { useEffect } from "react";
import { reportBoundaryError } from "@/lib/observability/report";
import "./globals.css";

/**
 * The last resort: the page's own frame broke, so this renders its own document. Plain Thai, one button, no jargon —
 * it must work even when nothing else in the app does, so it uses no component from the app.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportBoundaryError(error, error.digest), [error]);
  return (
    <html lang="th">
      <body>
        <main id="main" className="mx-auto flex min-h-dvh max-w-lg items-center px-4 py-10">
          <div className="w-full rounded-3xl border border-line bg-surface p-6 text-center text-ink">
            <h1 className="text-xl font-semibold">ระบบขัดข้องชั่วคราว</h1>
            <p className="mt-2 text-sm text-ink-2">ข้อมูลที่บันทึกไปแล้วไม่หาย ลองอีกครั้งได้เลย ถ้ายังใช้ไม่ได้ ปิดแล้วเปิดแอปใหม่</p>
            {error.digest && (
              <p className="mt-3 text-sm text-ink-3">
                รหัสอ้างอิง <span className="font-semibold text-ink">{error.digest}</span>
              </p>
            )}
            <button type="button" onClick={() => retry()} className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-brand px-5 text-[15px] font-medium text-brand-ink">
              ลองอีกครั้ง
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
