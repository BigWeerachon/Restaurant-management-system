"use client";

import { Monitor, MonitorSmartphone, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Badge, Callout, Card, Field, Input, Select } from "@/components/ui/primitives";
import { showError } from "@/hooks/use-sabai";
import { DEVICE_KINDS, listDevices, registerThisDevice, revokeDevice, type DeviceKind, type DeviceRow } from "@/lib/data-source/devices";
import { getApiSession } from "@/lib/data-source/http-client";
import { getDevice } from "@/lib/device";
import { isDomainError, useSabai } from "@/lib/demo/store";

const kindLabel = (k: string) => DEVICE_KINDS.find((x) => x.value === k)?.label ?? k;

const seen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "ยังไม่เคยใช้";

/**
 * Settings → tills. Registering this browser lets staff open it, tap their name and enter a PIN — no e-mail on the
 * device. A lost or retired device is cancelled here and stops working at once.
 */
export function DevicesPanel() {
  const branches = useSabai((s) => s.db.branches);
  const currentBranch = useSabai((s) => s.session.branchId) ?? branches[0]?.id ?? "";
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DeviceKind>("pos");
  const [branchId, setBranchId] = useState(currentBranch);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = getDevice();

  const reload = useCallback(async () => {
    try {
      setRows(await listDevices());
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const register = async () => {
    if (!name.trim()) return setNameError("ตั้งชื่อเครื่องก่อนนะ เช่น “iPad หน้าร้าน”");
    setBusy(true);
    try {
      await registerThisDevice({ name: name.trim(), kind, branchId });
      toast.success("ลงทะเบียนเครื่องนี้แล้ว", { description: "ต่อไปพนักงานเปิดแอปบนเครื่องนี้ กดชื่อตัวเอง แล้วใส่ PIN ได้เลย ไม่ต้องใช้อีเมล" });
      setAdding(false);
      setName("");
      await reload();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (d: DeviceRow) => {
    setBusy(true);
    try {
      await revokeDevice(d.id);
      toast.success(`ยกเลิก “${d.name}” แล้ว`, { description: "เครื่องนี้ใช้เข้าระบบด้วย PIN ไม่ได้อีก" });
      setRevoking(null);
      await reload();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const active = rows?.filter((r) => r.is_active) ?? [];
  const cancelled = rows?.filter((r) => !r.is_active) ?? [];
  const thisRegistered = !!mine && mine.tenantId === getApiSession().tenantId && active.some((r) => r.id === mine.deviceId);

  return (
    <div className="space-y-4">
      <Callout tone="info" title="เครื่องในร้านคืออะไร">
        ลงทะเบียนแท็บเล็ตหรือจอที่ใช้ประจำในร้านไว้ครั้งเดียว พนักงานจะเข้าด้วย PIN ได้เลยโดยไม่ต้องมีบัญชีอีเมล ถ้าเครื่องหายหรือเลิกใช้ กดยกเลิกที่นี่ เครื่องนั้นจะใช้ไม่ได้ทันที
      </Callout>

      {error ? (
        <Callout tone="danger" title="โหลดรายการเครื่องไม่สำเร็จ" action={<Button size="sm" variant="secondary" onClick={() => void reload()}>ลองอีกครั้ง</Button>}>
          {isDomainError(error) && error.code === "PERMISSION_DENIED" ? "ต้องมีสิทธิ์ตั้งค่าร้านจึงจะดูรายการเครื่องได้" : "ลองอีกครั้ง ถ้ายังไม่ได้ ติดต่อทีมงาน Sabai"}
        </Callout>
      ) : rows === null ? (
        <p role="status" className="text-sm text-ink-3">กำลังโหลดรายการเครื่อง…</p>
      ) : (
        <>
          {active.length === 0 ? (
            <Card className="p-5 text-center">
              <MonitorSmartphone className="mx-auto h-8 w-8 text-ink-3" aria-hidden="true" />
              <p className="mt-2 font-semibold text-ink">ยังไม่มีเครื่องที่ลงทะเบียน</p>
              <p className="text-sm text-ink-3">เปิดหน้านี้บนแท็บเล็ตของร้านแล้วกด “ลงทะเบียนเครื่องนี้”</p>
            </Card>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {active.map((d) => (
                <li key={d.id}>
                  <Card className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start gap-3">
                      <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">
                          {d.name} {mine?.deviceId === d.id && <Badge tone="brand">เครื่องนี้</Badge>}
                        </p>
                        <p className="text-sm text-ink-3">
                          {kindLabel(d.kind)} · {branches.find((b) => b.id === d.branch_id)?.name ?? "สาขา"}
                        </p>
                        <p className="mt-1 text-xs text-ink-3">
                          ใช้ล่าสุด {seen(d.last_seen_at)}
                          {d.registered_by_name ? ` · ลงทะเบียนโดย ${d.registered_by_name}` : ""}
                        </p>
                        {d.kind === "pos" && (
                          <p className="text-xs text-ink-3">
                            {d.receipt_code ? `เลขใบเสร็จของเครื่องนี้ขึ้นต้นด้วย ${branches.find((b) => b.id === d.branch_id)?.code ?? "HQ"}-${d.receipt_code}` : "เลขใบเสร็จของเครื่องนี้จะแยกชุดเมื่อขายครั้งแรก"}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="self-start" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRevoking(d)}>
                      ยกเลิกเครื่องนี้
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {!thisRegistered && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => (setBranchId(currentBranch), setAdding(true))}>
              ลงทะเบียนเครื่องนี้
            </Button>
          )}
          {cancelled.length > 0 && (
            <details className="text-sm text-ink-3">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink-2">เครื่องที่ยกเลิกแล้ว ({cancelled.length})</summary>
              <ul className="mt-1 space-y-1">
                {cancelled.map((d) => (
                  <li key={d.id}>
                    {d.name} — ยกเลิกเมื่อ {seen(d.revoked_at)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Dialog
        open={adding}
        onOpenChange={(o) => !o && setAdding(false)}
        title="ลงทะเบียนเครื่องนี้"
        description="หลังลงทะเบียน พนักงานเข้าด้วย PIN บนเครื่องนี้ได้เลย"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              ยกเลิก
            </Button>
            <Button loading={busy} onClick={() => void register()}>
              ลงทะเบียน
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-2">
          <Field label="ชื่อเครื่อง" htmlFor="device-name" required error={nameError}>
            <Input id="device-name" autoFocus value={name} invalid={!!nameError} placeholder="เช่น iPad หน้าร้าน" onChange={(e) => (setName(e.target.value), setNameError(null))} onKeyDown={(e) => e.key === "Enter" && void register()} />
          </Field>
          <Field label="ใช้ทำอะไร" htmlFor="device-kind">
            <Select id="device-kind" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
              {DEVICE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          {branches.length > 1 && (
            <Field label="ประจำสาขา" htmlFor="device-branch" hint="พนักงานที่เข้าเครื่องนี้ได้คือคนที่ทำงานสาขานี้">
              <Select id="device-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `ยกเลิก “${revoking.name}”?` : "ยกเลิกเครื่อง"}
        description="เครื่องนี้จะเข้าระบบด้วย PIN ไม่ได้อีกทันที ข้อมูลการขายที่ผ่านมายังอยู่ครบ"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              ไม่ยกเลิก
            </Button>
            <Button variant="danger" loading={busy} onClick={() => revoking && void revoke(revoking)}>
              ยกเลิกเครื่องนี้
            </Button>
          </>
        }
      >
        <p className="pb-2 text-sm text-ink-2">ถ้าเครื่องนี้ยังอยู่กับคุณ ลงทะเบียนใหม่ได้ภายหลัง</p>
      </Dialog>
    </div>
  );
}
