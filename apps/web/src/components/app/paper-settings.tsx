"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout, Card, Segmented } from "@/components/ui/primitives";
import { getPaperWidth, printSampleReceipt, setPaperWidth, type PaperWidth } from "@/lib/print";

/** The receipt printer of this device: which roll is in it, and a test slip to see the result. */
export function PaperSettings() {
  const [width, setWidth] = useState<PaperWidth>(() => getPaperWidth());
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold text-ink">เครื่องพิมพ์ใบเสร็จของเครื่องนี้</h3>
        <p className="text-sm text-ink-3">แต่ละเครื่องในร้านตั้งของตัวเอง เพราะแต่ละเครื่องต่อเครื่องพิมพ์คนละตัว</p>
      </div>
      <Segmented
        label="ขนาดกระดาษ"
        className="w-full"
        value={String(width)}
        onChange={(v) => {
          const next = v === "58" ? 58 : 80;
          setWidth(next);
          setPaperWidth(next);
        }}
        options={[
          { value: "80", label: "80 มม. (มาตรฐาน)" },
          { value: "58", label: "58 มม. (เล็ก)" },
        ]}
      />
      <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => printSampleReceipt()}>
        ทดลองพิมพ์ใบเสร็จ
      </Button>
      <Callout tone="info" title="ตั้งเครื่องพิมพ์ให้ถูกครั้งเดียว">
        ในหน้าต่างพิมพ์ของเครื่อง เลือกเครื่องพิมพ์ความร้อน ขนาดกระดาษให้ตรงกับที่เลือกไว้ข้างบน เอาหัวกระดาษ/ท้ายกระดาษของเบราว์เซอร์ออก และตั้งระยะขอบเป็นไม่มี
      </Callout>
    </Card>
  );
}
