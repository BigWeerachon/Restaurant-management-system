"use client";

import { CircleCheck, Loader2, Plug, PlugZap, Printer, Unplug, Vault } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/overlay";
import { Badge, Callout, Card, Field, Input, Segmented } from "@/components/ui/primitives";
import { describePrinterError, initPrinter, openDrawerDirect, usePrinter, type PrintMode } from "@/lib/escpos/printer";
import type { TransportKind } from "@/lib/escpos/transports";
import { getPaperWidth, printSampleReceipt, setPaperWidth, type PaperWidth } from "@/lib/print";

const TRANSPORT_LABEL: Record<TransportKind, string> = { usb: "USB", serial: "Serial", bluetooth: "บลูทูธ" };

/** The receipt printer of this device: which roll is in it, how it is connected, and a test slip to see the result. */
export function PaperSettings() {
  const [width, setWidth] = useState<PaperWidth>(() => getPaperWidth());
  return (
    <div className="space-y-4">
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
      <DirectPrinter />
    </div>
  );
}

/** Connecting the printer straight to this browser (USB, serial or Bluetooth): no print dialog, Thai always drawn right, drawer and kitchen slips. */
function DirectPrinter() {
  const { settings, status, name, error, supported, loaded, set, connect, disconnect } = usePrinter();
  const codepageId = useId();
  useEffect(() => initPrinter(), []);
  if (!loaded) return null;

  if (supported.length === 0) {
    return (
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold text-ink">ต่อเครื่องพิมพ์ตรง</h3>
        <Callout tone="info" title="เบราว์เซอร์นี้ยังต่อเครื่องพิมพ์ตรงไม่ได้">
          การต่อ USB, Serial หรือบลูทูธเข้ากับเครื่องพิมพ์ใช้ได้ใน Chrome และ Edge (คอมพิวเตอร์ และแอนดรอยด์) ส่วน Safari/iPad ยังไม่รองรับ ระหว่างนี้พิมพ์ผ่านหน้าต่างพิมพ์ของเครื่องได้ตามปกติ
        </Callout>
      </Card>
    );
  }

  const transport = settings.transport;
  const ready = status === "ready";
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold text-ink">ต่อเครื่องพิมพ์ตรง</h3>
        <p className="text-sm text-ink-3">พิมพ์ใบเสร็จและใบครัวได้ทันทีไม่ต้องเปิดหน้าต่างพิมพ์ และสั่งเปิดลิ้นชักเก็บเงินได้ (เครื่องพิมพ์ความร้อนแบบ ESC/POS)</p>
      </div>

      <Segmented<TransportKind | "none">
        label="วิธีเชื่อมต่อเครื่องพิมพ์"
        className="w-full"
        value={transport ?? "none"}
        onChange={(v) => set({ transport: v === "none" ? null : v })}
        options={[{ value: "none", label: "ไม่ต่อตรง" }, ...supported.map((k) => ({ value: k, label: TRANSPORT_LABEL[k] }))]}
      />

      {transport && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {ready ? (
              <Badge tone="success" icon={<CircleCheck className="h-4 w-4" aria-hidden="true" />}>
                เชื่อมต่อแล้ว · {name}
              </Badge>
            ) : status === "connecting" ? (
              <Badge tone="info" icon={<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}>
                กำลังเชื่อมต่อ…
              </Badge>
            ) : (
              <Badge tone="warning" icon={<Unplug className="h-4 w-4" aria-hidden="true" />}>
                ยังไม่ได้เชื่อมต่อ
              </Badge>
            )}
            {ready ? (
              <>
                <Button variant="secondary" icon={<Vault className="h-4 w-4" />} onClick={() => openDrawerDirect().catch((e) => toast.error("เปิดลิ้นชักไม่ได้", { description: describePrinterError(e) }))}>
                  ทดลองเปิดลิ้นชัก
                </Button>
                <Button variant="ghost" icon={<Unplug className="h-4 w-4" />} onClick={() => void disconnect()}>
                  ตัดการเชื่อมต่อ
                </Button>
              </>
            ) : (
              <Button icon={status === "error" ? <PlugZap className="h-4 w-4" /> : <Plug className="h-4 w-4" />} loading={status === "connecting"} onClick={() => void connect()}>
                {status === "error" ? "เชื่อมต่อใหม่" : "เชื่อมต่อเครื่องพิมพ์"}
              </Button>
            )}
          </div>
          {error && <Callout tone={status === "error" ? "danger" : "info"}>{error}</Callout>}
          {transport === "bluetooth" && <p className="text-sm text-ink-3">บลูทูธต้องกด เชื่อมต่อเครื่องพิมพ์ ใหม่ทุกครั้งที่เปิดหน้านี้ (เบราว์เซอร์กำหนดไว้เพื่อความปลอดภัย)</p>}

          <div className="space-y-2">
            <Segmented<PrintMode>
              label="รูปแบบการพิมพ์"
              className="w-full"
              value={settings.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: "picture", label: "ภาพ (แนะนำ)" },
                { value: "text", label: "ข้อความ" },
              ]}
            />
            <p className="text-sm text-ink-3">
              {settings.mode === "picture"
                ? "ระบบวาดใบเสร็จเป็นภาพแล้วส่งไป ภาษาไทยออกถูกต้องกับเครื่องพิมพ์ทุกรุ่น แต่ช้ากว่าข้อความเล็กน้อย"
                : "ส่งเป็นตัวอักษร เร็วกว่า แต่เครื่องพิมพ์ต้องมีชุดตัวอักษรไทยและต้องตั้งเลขรหัสให้ตรง ถ้าตั้งผิดตัวหนังสือจะเพี้ยน — ถ้าไม่แน่ใจให้ใช้แบบภาพ"}
            </p>
            {settings.mode === "text" && (
              <Field label="เลขรหัสชุดอักษรไทย (ESC t)" htmlFor={codepageId} hint="ดูจากตารางรหัสในคู่มือเครื่องพิมพ์ ตัวเลข 0–255">
                <Input id={codepageId} type="number" inputMode="numeric" min={0} max={255} value={settings.codepage} onChange={(e) => set({ codepage: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 0), 255) })} className="max-w-32" />
              </Field>
            )}
          </div>

          <div className="space-y-4 border-t border-line pt-4">
            <Switch checked={settings.autoReceipt} onCheckedChange={(autoReceipt) => set({ autoReceipt })} label="พิมพ์ใบเสร็จเองเมื่อรับเงิน" description="ไม่ต้องกดพิมพ์ทุกบิล (ยังกดพิมพ์ซ้ำเป็นสำเนาได้)" />
            <Switch checked={settings.drawer} onCheckedChange={(drawer) => set({ drawer })} label="เปิดลิ้นชักเมื่อรับเงินสด" description="ต้องต่อสายลิ้นชักเข้าที่ช่อง DK/RJ-11 ของเครื่องพิมพ์" />
            <Switch checked={settings.autoKitchen} onCheckedChange={(autoKitchen) => set({ autoKitchen })} label="พิมพ์ใบครัวเมื่อมีออเดอร์ใหม่" description="ใช้กับเครื่องพิมพ์ที่ตั้งไว้ในครัว ออเดอร์ที่ค้างอยู่ก่อนเปิดตัวเลือกนี้จะไม่ถูกพิมพ์ซ้ำ" />
            <Switch checked={settings.cut} onCheckedChange={(cut) => set({ cut })} label="ตัดกระดาษเองหลังพิมพ์" description="ปิดไว้ถ้าเครื่องพิมพ์ไม่มีใบมีด" />
          </div>
        </>
      )}
    </Card>
  );
}
