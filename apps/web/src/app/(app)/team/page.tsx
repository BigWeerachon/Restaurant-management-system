"use client";

import { accessFromRole, navigationFor, PERMISSION_MODULES, PERMISSIONS, planLimit, planOf, type Permission, type PermissionModule } from "@sabai/domain";
import { ArrowLeft, ArrowRight, Check, KeyRound, Lock, MoreHorizontal, RotateCcw, Shuffle, UserPlus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Keypad, PinDots, ProgressBar, Stepper, SuccessCheck } from "@/components/ui/feedback";
import { Dialog, Switch, TabPanel, Tabs } from "@/components/ui/overlay";
import { Avatar, Badge, Callout, Card, Field, Input, Segmented } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { useSabai } from "@/lib/demo/store";
import type { Member, Role } from "@/lib/demo/types";

const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

function PinPad({ pin, onChange }: { pin: string; onChange: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <PinDots length={4} filled={pin.length} />
      <p className="text-3xl font-bold tracking-[0.4em] tabular text-ink" aria-live="polite">
        {pin.padEnd(4, "·")}
      </p>
      <Keypad className="w-full max-w-72" onKey={(k) => pin.length < 4 && onChange(pin + k)} onBackspace={() => onChange(pin.slice(0, -1))} onClear={() => onChange("")} />
      <Button variant="ghost" size="sm" icon={<Shuffle className="h-4 w-4" />} onClick={() => onChange(randomPin())}>
        สุ่ม PIN ให้
      </Button>
    </div>
  );
}

function roleNavSummary(role: Role) {
  const access = accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] });
  const nav = navigationFor(access, role.key);
  return [...nav.primary, ...nav.more].map((n) => n.th);
}

// ---------------------------------------------------------------------------
// Add staff — name → job → PIN, done in under a minute
// ---------------------------------------------------------------------------
function AddStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useSabai((s) => s.db);
  const { exec, pending } = useDsAction();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [roleKey, setRoleKey] = useState("cashier");
  const [branchIds, setBranchIds] = useState<"all" | string[]>("all");
  const [pin, setPin] = useState(randomPin);
  const [done, setDone] = useState<Member | null>(null);
  const [error, setError] = useState("");
  const roles = db.roles.filter((r) => !r.grantsAll);
  const role = db.roles.find((r) => r.key === roleKey);

  const reset = () => {
    setStep(0);
    setName("");
    setRoleKey("cashier");
    setBranchIds("all");
    setPin(randomPin());
    setDone(null);
    setError("");
  };
  const close = () => {
    onClose();
    setTimeout(reset, 250);
  };
  const next = () => {
    if (step === 0 && !name.trim()) return setError("ใส่ชื่อที่ทีมใช้เรียก");
    setError("");
    setStep(step + 1);
  };
  const save = async () => {
    const r = await exec((ds) => ds.addMember({ name, roleKey, pin, branchIds }), { success: "เพิ่มพนักงานแล้ว" });
    if (r.ok) setDone(r.value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && close()}
      title={done ? "เพิ่มพนักงานเรียบร้อย" : "เพิ่มพนักงาน"}
      description={done ? undefined : "3 ขั้นตอน ไม่ต้องใช้อีเมล — พนักงานเข้าเครื่องร้านด้วย PIN"}
      size="md"
      footer={
        done ? (
          <Button onClick={close}>เสร็จ</Button>
        ) : (
          <>
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)} icon={<ArrowLeft className="h-4 w-4" />}>
                ย้อนกลับ
              </Button>
            )}
            {step < 2 ? (
              <Button onClick={next} iconRight={<ArrowRight className="h-4 w-4" />}>
                ต่อไป
              </Button>
            ) : (
              <Button loading={pending} disabled={pin.length !== 4} onClick={save} icon={<Check className="h-4 w-4" />}>
                เพิ่ม {name}
              </Button>
            )}
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <SuccessCheck size={72} />
          <p className="text-lg font-semibold text-ink">{done.name} พร้อมทำงานแล้ว</p>
          <div className="w-full rounded-2xl border border-dashed border-line-strong p-4">
            <p className="text-sm text-ink-3">บอก PIN นี้ให้พนักงาน (เปลี่ยนได้ภายหลัง)</p>
            <p className="mt-1 text-4xl font-bold tracking-[0.35em] tabular text-ink">{done.pin}</p>
          </div>
          <p className="text-sm text-ink-3">ที่เครื่องร้าน แตะรูปคน → ใส่ PIN → ระบบเปิดหน้าที่ตรงกับงานของ{done.name}ให้เอง</p>
        </div>
      ) : (
        <div className="space-y-5 pb-2">
          <Stepper steps={["ชื่อ", "ทำหน้าที่อะไร", "PIN"]} current={step} />
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
              {step === 0 && (
                <Field label="ชื่อที่ทีมใช้เรียก" required error={error} htmlFor="nm" hint="เช่น น้องแพรว — แสดงบนบิลและประวัติการทำงาน">
                  <Input id="nm" autoFocus value={name} invalid={!!error} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && next()} />
                </Field>
              )}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="ตำแหน่ง">
                    {roles.map((r) => (
                      <button key={r.key} type="button" role="radio" aria-checked={roleKey === r.key} onClick={() => setRoleKey(r.key)} className={cn("rounded-2xl border p-3 text-left transition-colors", roleKey === r.key ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-line hover:border-line-strong")}>
                        <span className="block font-semibold text-ink">{r.name}</span>
                        <span className="block text-sm text-ink-3">{r.description}</span>
                      </button>
                    ))}
                  </div>
                  {role && (
                    <p className="rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
                      {name || "พนักงาน"}จะเห็นเฉพาะ: <strong className="text-ink">{roleNavSummary(role).join(" · ")}</strong>
                    </p>
                  )}
                  {db.branches.length > 1 && (
                    <Segmented
                      label="ทำงานที่สาขา"
                      className="w-full"
                      value={branchIds === "all" ? "all" : branchIds[0]!}
                      onChange={(v) => setBranchIds(v === "all" ? "all" : [v])}
                      options={[{ value: "all", label: "ทุกสาขา" }, ...db.branches.map((b) => ({ value: b.id, label: b.name }))]}
                    />
                  )}
                </div>
              )}
              {step === 2 && <PinPad pin={pin} onChange={setPin} />}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit member
// ---------------------------------------------------------------------------
function EditMemberDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const db = useSabai((s) => s.db);
  const { member: me } = useAccess();
  const { exec, pending } = useDsAction();
  const [mode, setMode] = useState<"edit" | "pin">("edit");
  const [roleKey, setRoleKey] = useState(member?.roleKey ?? "");
  const [discount, setDiscount] = useState(String(Math.round((member?.maxDiscountRate ?? 0) * 100)));
  const [pin, setPin] = useState("");
  const [key, setKey] = useState(member?.id);
  if (member && key !== member.id) {
    setKey(member.id);
    setRoleKey(member.roleKey);
    setDiscount(String(Math.round((member.maxDiscountRate ?? 0) * 100)));
    setMode("edit");
    setPin("");
  }
  if (!member) return null;
  const save = async () => {
    const r = await exec((ds) => ds.updateMember(member.id, { roleKey, maxDiscountRate: Number(discount) / 100 }), { success: "บันทึกแล้ว" });
    if (r.ok) onClose();
  };
  const savePin = async () => {
    const r = await exec((ds) => ds.resetMemberPin(member.id, pin), { success: "ตั้ง PIN ใหม่แล้ว", successDetail: `PIN ใหม่ของ${member.name}: ${pin}` });
    if (r.ok) onClose();
  };
  const deactivate = async () => {
    const r = await exec((ds) => ds.updateMember(member.id, { active: false }), { success: `ปิดการใช้งาน ${member.name} แล้ว`, successDetail: "ประวัติการทำงานยังเก็บไว้ครบ" });
    if (r.ok) onClose();
  };
  return (
    <Dialog
      open={!!member}
      onOpenChange={(v) => !v && onClose()}
      title={member.name}
      description={db.roles.find((r) => r.key === member.roleKey)?.name}
      size="md"
      footer={
        mode === "edit" ? (
          <>
            {member.id !== me?.id && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={deactivate}>
                ปิดการใช้งาน
              </Button>
            )}
            <Button loading={pending} onClick={save}>
              บันทึก
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode("edit")}>
              ยกเลิก
            </Button>
            <Button loading={pending} disabled={pin.length !== 4} onClick={savePin}>
              ตั้ง PIN นี้
            </Button>
          </>
        )
      }
    >
      {mode === "edit" ? (
        <div className="space-y-4 pb-2">
          <Field label="ตำแหน่ง" htmlFor="role">
            <div id="role" className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="ตำแหน่ง">
              {db.roles.map((r) => (
                <button key={r.key} type="button" role="radio" aria-checked={roleKey === r.key} onClick={() => setRoleKey(r.key)} className={cn("rounded-xl border px-3 py-2 text-left text-sm", roleKey === r.key ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                  {r.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="ให้ส่วนลดได้เองไม่เกิน" hint="เกินจากนี้ต้องให้ผู้จัดการอนุมัติด้วย PIN" htmlFor="disc">
            <Input id="disc" inputMode="numeric" suffix="%" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          </Field>
          <Button variant="secondary" block icon={<KeyRound className="h-4 w-4" />} onClick={() => setMode("pin")}>
            ตั้ง PIN ใหม่ (กรณีลืม)
          </Button>
        </div>
      ) : (
        <div className="pb-2">
          <PinPad pin={pin} onChange={setPin} />
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Roles — plain-language permission matrix
// ---------------------------------------------------------------------------
function Roles() {
  const db = useSabai((s) => s.db);
  const { exec, pending } = useDsAction();
  const [roleKey, setRoleKey] = useState(db.roles.find((r) => !r.grantsAll)?.key ?? "");
  const role = db.roles.find((r) => r.key === roleKey)!;
  const [draft, setDraft] = useState<Set<string>>(() => new Set(role?.permissions));
  const [loadedFor, setLoadedFor] = useState(roleKey);
  if (loadedFor !== roleKey) {
    setLoadedFor(roleKey);
    setDraft(new Set(role.permissions));
  }
  const changed = useMemo(() => {
    const orig = new Set(role.permissions);
    return [...draft].filter((p) => !orig.has(p)).length + role.permissions.filter((p) => !draft.has(p)).length;
  }, [draft, role]);
  const modules = Object.keys(PERMISSION_MODULES) as PermissionModule[];
  const preview = roleNavSummary({ ...role, permissions: [...draft] });
  const people = db.members.filter((m) => m.active && m.roleKey === role.key).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="ตำแหน่ง" className="flex gap-2 overflow-x-auto lg:flex-col">
        {db.roles.map((r) => (
          <button key={r.key} onClick={() => setRoleKey(r.key)} aria-current={r.key === roleKey} className={cn("flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[15px]", r.key === roleKey ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2 hover:bg-surface-2")}>
            {r.name}
            <span className="text-xs text-ink-3">{db.members.filter((m) => m.active && m.roleKey === r.key).length} คน</span>
          </button>
        ))}
      </nav>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-ink">{role.name}</h3>
            <p className="text-sm text-ink-3">
              {role.description} · ใช้อยู่ {people} คน
            </p>
          </div>
          {!role.grantsAll && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={!changed} icon={<RotateCcw className="h-4 w-4" />} onClick={() => setDraft(new Set(role.permissions))}>
                คืนค่า
              </Button>
              <Button size="sm" disabled={!changed} loading={pending} onClick={() => exec((ds) => ds.setRolePermissions(role.key, [...draft]), { success: `บันทึกสิทธิ์ ${role.name} แล้ว`, successDetail: `มีผลกับพนักงาน ${people} คนทันที` })}>
                บันทึก{changed ? ` (${changed})` : ""}
              </Button>
            </div>
          )}
        </div>
        {role.grantsAll ? (
          <div className="p-5">
            <Callout tone="info" title="เจ้าของร้านมีสิทธิ์ทุกอย่างเสมอ">
              รวมถึงฟีเจอร์ใหม่ที่จะเพิ่มในอนาคต จึงไม่ต้องตั้งค่า และต้องมีเจ้าของร้านอย่างน้อย 1 คนเสมอ
            </Callout>
          </div>
        ) : (
          <>
            <p className="border-b border-line bg-surface-2 px-5 py-3 text-sm text-ink-2">
              ตำแหน่งนี้จะเห็นเมนู: <strong className="text-ink">{preview.length ? preview.join(" · ") : "ยังไม่มี"}</strong>
            </p>
            <div className="divide-y divide-line">
              {modules.map((mod) => {
                const perms = PERMISSIONS.filter((p) => p.module === mod);
                if (!perms.length) return null;
                return (
                  <div key={mod} role="group" aria-labelledby={`mod-${mod}`} className="px-5 py-4">
                    <h4 id={`mod-${mod}`} className="mb-2 text-sm font-semibold text-ink-3">
                      {PERMISSION_MODULES[mod].th}
                    </h4>
                    <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
                      {perms.map((p) => (
                        <Switch
                          key={p.key}
                          checked={draft.has(p.key)}
                          onCheckedChange={(v) => {
                            const next = new Set(draft);
                            if (v) next.add(p.key);
                            else next.delete(p.key);
                            setDraft(next);
                          }}
                          label={
                            <span className="inline-flex flex-wrap items-center gap-2">
                              {p.th}
                              {p.risk === "high" && (
                                <Badge tone="warning" icon={<Lock className="h-3 w-3" aria-hidden="true" />}>
                                  สำคัญ
                                </Badge>
                              )}
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function TeamPage() {
  const db = useSabai((s) => s.db);
  const load = useLoad(["team"]);
  const [tab, setTab] = useState("people");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const active = db.members.filter((m) => m.active);
  const inactive = db.members.filter((m) => !m.active);
  const { exec } = useDsAction();
  const limit = planLimit(db.tenant.plan, "staff");
  const branchName = (m: Member) => (m.branchIds === "all" ? "ทุกสาขา" : m.branchIds.map((id) => db.branches.find((b) => b.id === id)?.name).join(", "));

  return (
    <>
      <PageHeader title="ทีมงาน" description="เพิ่มพนักงานได้ในไม่ถึงนาที ไม่ต้องใช้อีเมล — แต่ละคนเห็นเฉพาะงานของตัวเอง" actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>เพิ่มพนักงาน</Button>} />
      <LoadBanner state={load} className="mb-4" />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: "people", label: "พนักงาน", count: active.length }, { value: "roles", label: "ตำแหน่งและสิทธิ์" }]}>
        <TabPanel value="people" className="space-y-4 pt-4">
          {limit !== null && (
            <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <p className="text-sm text-ink-2 sm:w-64">
                ใช้ไป <strong className="text-ink">{active.length}</strong> จาก {limit} คน (แพ็กเกจ{planOf(db.tenant.plan).name})
              </p>
              <ProgressBar className="flex-1" value={active.length / limit} tone={active.length / limit > 0.9 ? "warning" : "brand"} label="จำนวนพนักงานเทียบกับแพ็กเกจ" />
            </Card>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((m, i) => {
              const role = db.roles.find((r) => r.key === m.roleKey);
              return (
                <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <Card interactive className="flex items-center gap-3 p-4">
                    <Avatar name={m.name} color={m.color} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{m.name}</p>
                      <p className="truncate text-sm text-ink-3">
                        {role?.name} · {branchName(m)}
                      </p>
                    </div>
                    <button onClick={() => setEditing(m)} className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`จัดการ ${m.name}`}>
                      <MoreHorizontal className="h-5 w-5" />
                    </button>
                  </Card>
                </motion.li>
              );
            })}
          </ul>
          {inactive.length > 0 && (
            <details className="rounded-2xl border border-line p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink-2">ปิดการใช้งานแล้ว ({inactive.length})</summary>
              <ul className="mt-3 space-y-2">
                {inactive.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 text-ink-3">
                    <Avatar name={m.name} color={m.color} size={32} className="opacity-60" />
                    <span className="flex-1">{m.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => exec((ds) => ds.updateMember(m.id, { active: true }), { success: `เปิดใช้งาน ${m.name} อีกครั้ง` })}>
                      เปิดใช้งาน
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </TabPanel>
        <TabPanel value="roles" className="pt-4">
          <Roles />
        </TabPanel>
      </Tabs>
      <AddStaffDialog open={adding} onClose={() => setAdding(false)} />
      <EditMemberDialog member={editing} onClose={() => setEditing(null)} />
    </>
  );
}
