"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { formatThaiDate } from "@sabai/domain";
import { Check, ChevronDown, ChevronsUpDown, LogOut, Monitor, MoonStar, MoreHorizontal, RefreshCcw, Search, Sun, UserRoundCog } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/overlay";
import { ProgressRing } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { Avatar, Kbd } from "@/components/ui/primitives";
import { useLoad } from "@/hooks/use-data-source";
import { BillingBanner } from "./billing-banner";
import { ConnectionBadge } from "./connection-badge";
import { useAccess, useBusinessDate, useUi } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { dataSourceMode, getDataSource } from "@/lib/data-source";
import { onboarding } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import { CommandPalette } from "./command-palette";

export function Logo({ compact }: { compact?: boolean }) {
  if (compact) {
    return <Image src="/brand/paakin-icon.png" alt="Paak In" width={512} height={512} priority className="h-9 w-9" />;
  }
  return <Image src="/brand/paakin-logo.png" alt="Paak In" width={1465} height={364} priority className="h-8 w-auto" />;
}

function useTheme() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("sabai-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  const apply = (t: "system" | "light" | "dark") => {
    setTheme(t);
    try {
      if (t === "system") {
        localStorage.removeItem("sabai-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("sabai-theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {}
  };
  return [theme, apply] as const;
}

function BranchSwitcher({ className }: { className?: string }) {
  const { branch, branches } = useAccess();
  if (branches.length <= 1) {
    return <div className={cn("truncate text-sm font-medium text-ink-2", className)}>{branch.name}</div>;
  }
  return (
    <DM.Root>
      <DM.Trigger className={cn("glass flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-ink", className)} aria-label={`${branch.name} (เปลี่ยนสาขา)`}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
        <ChevronsUpDown className="h-4 w-4 text-ink-3" aria-hidden="true" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} className="glass-overlay z-50 min-w-56 rounded-2xl p-1.5 animate-fade-in">
          <DM.Label className="px-2.5 py-1.5 text-xs text-ink-3">สาขา</DM.Label>
          {branches.map((b) => (
            <DM.Item key={b.id} onSelect={() => void getDataSource().setBranch(b.id)} className="flex h-11 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-[15px] text-ink outline-none data-[highlighted]:bg-surface-2">
              <span className="flex-1">{b.name}</span>
              {b.id === branch.id && <Check className="h-4 w-4 text-brand" aria-hidden="true" />}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function UserMenu({ side = "top", compact }: { side?: "top" | "bottom"; compact?: boolean }) {
  const { member, role } = useAccess();
  const reset = useSabai((s) => s.reset);
  const mode = useSabai((s) => s.db.mode);
  const openSwitch = useUi((s) => s.setSwitchUserOpen);
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  if (!member) return null;
  const item = "flex h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-[15px] text-ink outline-none data-[highlighted]:bg-surface-2";
  return (
    <>
      <DM.Root>
        <DM.Trigger className={cn("flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-surface-2", compact && "w-auto p-1")} aria-label={compact ? `${member.name} (เมนูบัญชี)` : undefined}>
          <Avatar name={member.name} color={member.color} size={36} />
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{member.name}</span>
              <span className="block truncate text-xs text-ink-3">{role?.name}</span>
            </span>
          )}
          {!compact && <ChevronDown className="h-4 w-4 text-ink-3" aria-hidden="true" />}
        </DM.Trigger>
        <DM.Portal>
          <DM.Content side={side} align="end" sideOffset={8} className="glass-overlay z-50 w-64 rounded-2xl p-1.5 animate-fade-in">
            <div className="px-2.5 py-2">
              <p className="text-sm font-semibold text-ink">{member.name}</p>
              <p className="text-xs text-ink-3">{role?.name} · {role?.description}</p>
            </div>
            <DM.Separator className="my-1 h-px bg-line" />
            <DM.Item className={item} onSelect={() => openSwitch(true)}>
              <UserRoundCog className="h-4 w-4 text-ink-3" aria-hidden="true" /> สลับผู้ใช้ด้วย PIN
            </DM.Item>
            <DM.Label className="px-2.5 pb-1 pt-2 text-xs text-ink-3">ธีม</DM.Label>
            {([
              ["system", "ตามเครื่อง", Monitor],
              ["light", "สว่าง", Sun],
              ["dark", "มืด", MoonStar],
            ] as const).map(([v, label, Ico]) => (
              <DM.Item key={v} className={item} onSelect={() => setTheme(v)}>
                <Ico className="h-4 w-4 text-ink-3" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {theme === v && <Check className="h-4 w-4 text-brand" aria-hidden="true" />}
              </DM.Item>
            ))}
            <DM.Separator className="my-1 h-px bg-line" />
            {dataSourceMode() === "demo" && (
              <DM.Item className={item} onSelect={() => setConfirmReset(true)}>
                <RefreshCcw className="h-4 w-4 text-ink-3" aria-hidden="true" /> {mode === "demo" ? "รีเซ็ตร้านตัวอย่าง" : "ล้างร้านทดลอง"}
              </DM.Item>
            )}
            <DM.Item
              className={item}
              onSelect={async () => {
                await getDataSource().signOut();
                router.push("/");
              }}
            >
              <LogOut className="h-4 w-4 text-ink-3" aria-hidden="true" /> ออกจากระบบ
            </DM.Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <Dialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="เริ่มข้อมูลตัวอย่างใหม่?"
        description="ข้อมูลที่ทดลองทำไว้ในเครื่องนี้จะถูกแทนที่ด้วยข้อมูลตั้งต้น"
        size="sm"
        footer={
          <>
            <button className="h-11 rounded-xl px-4 font-medium text-ink-2 hover:bg-surface-2" onClick={() => setConfirmReset(false)}>
              ยกเลิก
            </button>
            <button
              className="h-11 rounded-xl bg-brand px-4 font-medium text-brand-ink hover:bg-brand-hover"
              onClick={() => {
                reset(mode);
                setConfirmReset(false);
                router.push("/");
              }}
            >
              เริ่มใหม่
            </button>
          </>
        }
      />
    </>
  );
}

function SetupProgress() {
  const { can } = useAccess();
  return can("settings.manage") ? <SetupProgressCard /> : null;
}

function SetupProgressCard() {
  const db = useSabai((s) => s.db);
  useLoad(["onboarding"]);
  const p = onboarding(db);
  if (p.isComplete) return null;
  return (
    <Link href="/setup" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-xs transition-shadow hover:shadow-md">
      <ProgressRing value={p.percent} size={44} stroke={5} label="ความคืบหน้าการตั้งค่าร้าน">
        <span className="text-[11px] font-semibold text-ink">{p.percent}%</span>
      </ProgressRing>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">ตั้งค่าร้านให้พร้อม</span>
        <span className="block truncate text-xs text-ink-3">ต่อไป: {p.next?.title}</span>
      </span>
    </Link>
  );
}

function NavLink({ href, icon, label, active, layoutId }: { href: string; icon: string; label: string; active: boolean; layoutId: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors", active ? "text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink")}>
      {active && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-xl bg-surface/70 shadow-sm ring-1 ring-[var(--glass-border)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
      <Icon name={icon} className={cn("relative h-5 w-5", active && "text-brand")} />
      <span className="relative">{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { nav, member } = useAccess();
  const tenantName = useSabai((s) => s.db.tenant.name);
  const mode = useSabai((s) => s.db.mode);
  const setCommand = useUi((s) => s.setCommandOpen);
  const date = useBusinessDate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const moreActive = nav.more.some((n) => isActive(n.href));

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <div className="glass-field min-h-dvh bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">
        ข้ามไปยังเนื้อหา
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col gap-4 border-r border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-4 py-5 backdrop-blur-xl backdrop-saturate-150 lg:flex">
        <div className="px-1">
          <Logo />
        </div>
        <div>
          <p className="mb-1.5 truncate px-1 text-xs font-medium text-ink-3">{tenantName}</p>
          <BranchSwitcher />
        </div>
        <nav aria-label="เมนูหลัก" className="flex flex-1 flex-col gap-1 overflow-y-auto scrollbar-thin">
          {nav.primary.map((n) => (
            <NavLink key={n.key} href={n.href} icon={n.icon} label={n.th} active={isActive(n.href)} layoutId="side-nav" />
          ))}
          {nav.more.length > 0 && (
            <>
              <button onClick={() => setShowMore((v) => !v)} aria-expanded={showMore || moreActive} className="mt-2 flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-ink-3 hover:text-ink">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" /> เพิ่มเติม
                <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", (showMore || moreActive) && "rotate-180")} aria-hidden="true" />
              </button>
              <AnimatePresence initial={false}>
                {(showMore || moreActive) && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex flex-col gap-1 overflow-hidden">
                    {nav.more.map((n) => (
                      <NavLink key={n.key} href={n.href} icon={n.icon} label={n.th} active={isActive(n.href)} layoutId="side-nav" />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </nav>
        <SetupProgress />
        <div className="border-t border-line pt-3">
          <UserMenu />
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <Logo compact />
              <div className="w-40 sm:w-52">
                <BranchSwitcher />
              </div>
            </div>
            <div className="hidden min-w-0 items-center gap-2 text-sm text-ink-3 lg:flex">
              <span className="font-medium text-ink-2">วันทำการ</span>
              <span className="tabular">{formatThaiDate(date)}</span>
              {mode === "fresh" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">ร้านทดลอง</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ConnectionBadge className="hidden md:flex" />
              <button onClick={() => setCommand(true)} className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-ink-3 shadow-xs hover:border-line-strong" aria-keyshortcuts="Control+K Meta+K">
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">ค้นหา</span>
                <span className="hidden items-center gap-0.5 sm:flex" aria-hidden="true">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
              <div className="lg:hidden">
                <UserMenu side="bottom" compact />
              </div>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
          {member ? (
            <>
              <BillingBanner />
              {children}
            </>
          ) : null}
        </main>
      </div>

      {/* Mobile tab bar: the four things this role does most, plus "more". */}
      <nav aria-label="เมนูหลัก" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {nav.primary.slice(0, nav.more.length ? 4 : 5).map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.key} href={n.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-brand" : "text-ink-2")}>
                {active && <motion.span layoutId="tab-nav" className="absolute top-0 h-[3px] w-10 rounded-full bg-brand" />}
                <Icon name={n.icon} className="h-6 w-6" />
                {n.th}
              </Link>
            );
          })}
          {nav.more.length > 0 && (
            <button onClick={() => setMoreOpen(true)} className={cn("flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", moreActive ? "text-brand" : "text-ink-2")}>
              <MoreHorizontal className="h-6 w-6" aria-hidden="true" />
              เพิ่มเติม
            </button>
          )}
        </div>
      </nav>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title="เมนูเพิ่มเติม" size="sm">
        <div className="grid grid-cols-3 gap-2 pb-4">
          {[...nav.primary.slice(4), ...nav.more].map((n) => (
            <Link key={n.key} href={n.href} className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2 p-4 text-center text-sm font-medium text-ink">
              <Icon name={n.icon} className="h-6 w-6 text-brand" />
              {n.th}
            </Link>
          ))}
        </div>
        <SetupProgress />
      </Dialog>
      <CommandPalette />
    </div>
  );
}
