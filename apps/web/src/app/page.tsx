"use client";

import { accessFromRole, homeFor, type Home, type Permission } from "@sabai/domain";
import { ArrowRight, Banknote, ChefHat, PiggyBank, Sparkles, Store } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/app/app-shell";
import { Splash } from "@/components/app/gate";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Avatar, Field, Input, Segmented } from "@/components/ui/primitives";
import { useSabai } from "@/lib/demo/store";

const ROLE_SEES: Record<string, string> = {
  owner: "ภาพรวม · กำไรจริง · ทุกอย่าง",
  manager: "หน้าร้าน · สต็อก · ทีม · ปิดยอด",
  cashier: "ขายหน้าร้าน · บิลวันนี้ · จอครัว",
  waiter: "รับออเดอร์ · ส่งเข้าครัว",
  kitchen: "จอครัว · ของเสีย · สูตรอาหาร",
  stock: "รับของ · นับสต็อก · สั่งซื้อ",
  accountant: "การเงิน · กระทบยอด · รายงาน",
};

export default function Welcome() {
  const hydrated = useSabai((s) => s.hydrated);
  const db = useSabai((s) => s.db);
  const signIn = useSabai((s) => s.signIn);
  const reset = useSabai((s) => s.reset);
  const router = useRouter();
  const [freshOpen, setFreshOpen] = useState(false);
  const [shopName, setShopName] = useState("");
  const [type, setType] = useState<"cafe" | "restaurant">("restaurant");
  const [nameError, setNameError] = useState<string | null>(null);

  if (!hydrated) return <Splash />;

  const enter = (memberId: string) => {
    const m = db.members.find((x) => x.id === memberId)!;
    const role = db.roles.find((r) => r.key === m.roleKey)!;
    signIn(m.id);
    router.push(homeFor(accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }), role.home as Home));
  };

  const startFresh = () => {
    if (!shopName.trim()) {
      setNameError("ตั้งชื่อร้านก่อนนะ เช่น “ครัวคุณแม่”");
      return;
    }
    reset("fresh", shopName.trim());
    useSabai.getState().patch((d) => {
      d.tenant.businessType = type;
    });
    useSabai.getState().signIn("m-owner");
    router.push("/setup");
  };

  const sample = db.mode === "demo";
  const members = sample ? db.members : [];

  return (
    <div className="glass-field relative min-h-dvh overflow-hidden bg-bg">
      <div className="relative mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:px-8">
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <Logo />
          <h1 className="mt-8 text-[34px] font-bold leading-[1.25] tracking-tight text-ink sm:text-5xl sm:leading-[1.2]">
            พนักงาน<span className="text-brand">ไม่ต้องเข้าใจระบบ</span>
            <br />
            ระบบเข้าใจวิธีทำงานของพนักงาน
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-2">
            ขายหน้าร้าน ครัว สต็อก สูตรอาหาร จัดซื้อ และการเงิน ในที่เดียว — แล้วตอบเจ้าของร้านได้ทันทีว่า
            <strong className="font-semibold text-ink"> อะไรขายดี ขายที่ไหน ผ่านช่องทางไหน และเหลือเงินจริงเท่าไร</strong>
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Store, title: "ขายใน 3 แตะ", text: "เมนูเป็นรูป ปุ่มใหญ่ ทอนเงินให้เอง" },
              { icon: ChefHat, title: "ครัวไม่พลาด", text: "ออเดอร์เด้งขึ้นจอ มีเวลาและสีเตือน" },
              { icon: PiggyBank, title: "รู้เงินเหลือจริง", text: "หัก GP ค่าธรรมเนียม ของเสีย ให้ครบ" },
            ].map((f, i) => (
              <motion.li key={f.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08 }} className="glass rounded-2xl p-4">
                <f.icon className="h-6 w-6 text-brand" aria-hidden="true" />
                <p className="mt-2 font-semibold text-ink">{f.title}</p>
                <p className="text-sm text-ink-3">{f.text}</p>
              </motion.li>
            ))}
          </ul>
        </motion.section>

        <motion.section
          aria-labelledby="enter-title"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass-overlay rounded-[28px] p-5 sm:p-7"
        >
          {sample ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="enter-title" className="text-xl font-semibold text-ink">
                    ลองใช้ร้านตัวอย่าง
                  </h2>
                  <p className="text-sm text-ink-3">{db.tenant.name} · 2 สาขา · ข้อมูลขายจริงย้อนหลัง 30 วัน</p>
                </div>
                <span className="hidden items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink sm:flex">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> ไม่ต้องสมัคร
                </span>
              </div>
              <p className="mb-3 mt-5 text-sm font-medium text-ink-2">เลือกว่าวันนี้คุณคือใคร — แต่ละตำแหน่งจะเห็นเฉพาะงานของตัวเอง</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {members.map((m, i) => {
                  const role = db.roles.find((r) => r.key === m.roleKey);
                  return (
                    <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.04 }}>
                      <button
                        onClick={() => enter(m.id)}
                        className="glass group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:shadow-md"
                      >
                        <Avatar name={m.name} color={m.color} size={44} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold leading-snug text-ink">{role?.name}</span>
                          <span className="block text-[13px] leading-snug text-ink-3">
                            {m.name} · {ROLE_SEES[m.roleKey]}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-3">สลับผู้ใช้บนเครื่องเดียวกันได้ด้วย PIN — เจ้าของ 1234 · ผู้จัดการ 2222 · แคชเชียร์ 3333 · เสิร์ฟ 4444 · ครัว 5555 · สต็อก 6666 · บัญชี 7777</p>
            </>
          ) : (
            <>
              <h2 id="enter-title" className="text-xl font-semibold text-ink">
                {db.tenant.name}
              </h2>
              <p className="text-sm text-ink-3">ร้านทดลองของคุณ ข้อมูลเก็บไว้ในเครื่องนี้</p>
              <Button size="lg" block className="mt-5" onClick={() => enter("m-owner")} iconRight={<ArrowRight className="h-4 w-4" />}>
                กลับไปที่ร้าน
              </Button>
              <Button variant="ghost" block className="mt-2" onClick={() => reset("demo")}>
                ดูร้านตัวอย่างแทน
              </Button>
            </>
          )}

          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
            <Banknote className="h-8 w-8 shrink-0 text-brand" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">เริ่มร้านของคุณเอง</p>
              <p className="text-sm text-ink-3">ระบบพาทำทีละขั้น ใช้เวลาประมาณ 10 นาที</p>
            </div>
            <Button variant="secondary" onClick={() => setFreshOpen(true)}>
              เริ่มเลย
            </Button>
          </div>
        </motion.section>
      </div>

      <Dialog
        open={freshOpen}
        onOpenChange={setFreshOpen}
        title="เปิดร้านใหม่ใน Sabai"
        description="ทดลองได้ทันที ไม่ต้องใช้อีเมล ข้อมูลเก็บในเครื่องนี้"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFreshOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={startFresh} iconRight={<ArrowRight className="h-4 w-4" />}>
              สร้างร้าน
            </Button>
          </>
        }
      >
        <div className="space-y-5 pb-2">
          <Field label="ชื่อร้าน" required error={nameError} htmlFor="shop">
            <Input
              id="shop"
              autoFocus
              value={shopName}
              invalid={!!nameError}
              placeholder="เช่น ครัวคุณแม่"
              onChange={(e) => {
                setShopName(e.target.value);
                setNameError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && startFresh()}
            />
          </Field>
          <Field label="ร้านของคุณเป็นแบบไหน" hint="ใช้ตั้งค่าเริ่มต้นให้เหมาะ เปลี่ยนภายหลังได้">
            <Segmented
              label="ประเภทร้าน"
              value={type}
              onChange={setType}
              className="w-full"
              options={[
                { value: "restaurant", label: "🍛 ร้านอาหาร" },
                { value: "cafe", label: "☕ คาเฟ่" },
              ]}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
