"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { reportBoundaryError } from "@/lib/observability/report";

/** A code a person can read out over the phone; the same one is on the report the team receives. */
const referenceOf = (digest?: string) => {
  const seed = (digest ?? Math.random().toString(16).slice(2)).replace(/[^0-9a-f]/gi, "").toUpperCase().padEnd(8, "0").slice(0, 8);
  return `${seed.slice(0, 4)}-${seed.slice(4)}`;
};

/**
 * What a person sees when a page breaks: what happened in plain Thai, that what was saved is safe, and the one thing to do
 * — never a stack trace, never "Application error". The break is reported (if an error tracker is set up) with this
 * reference so the team can find it.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [reference] = useState(() => referenceOf(error.digest));
  useEffect(() => reportBoundaryError(error, error.digest ?? reference), [error, reference]);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg items-center px-4 py-10">
      <Card className="w-full p-6 text-center">
        <TriangleAlert className="mx-auto h-10 w-10 text-warning" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold text-ink">หน้านี้ขัดข้องชั่วคราว</h1>
        <p className="mt-2 text-sm text-ink-2">ข้อมูลที่บันทึกไปแล้วไม่หาย ลองอีกครั้งได้เลย ถ้ายังใช้ไม่ได้ แจ้งรหัสอ้างอิงนี้กับทีมงาน Sabai</p>
        <p className="mt-3 text-sm text-ink-3">
          รหัสอ้างอิง <span className="tabular font-semibold text-ink">{reference}</span>
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>ลองอีกครั้ง</Button>
          <LinkButton href="/" variant="secondary">
            กลับหน้าแรก
          </LinkButton>
        </div>
      </Card>
    </main>
  );
}
