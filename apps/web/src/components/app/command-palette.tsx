"use client";

import { quickActionsFor } from "@sabai/domain";
import { Command } from "cmdk";
import { CornerDownLeft, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import * as RD from "@radix-ui/react-dialog";
import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/primitives";
import { useAccess, useUi } from "@/hooks/use-sabai";
import { useSabai } from "@/lib/demo/store";

/** ⌘K — power users jump anywhere; everyone else never needs it (progressive disclosure). */
export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setOpen = useUi((s) => s.setCommandOpen);
  const { nav, access, can } = useAccess();
  const db = useSabai((s) => s.db);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const item = "flex h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] text-ink-2 aria-selected:bg-surface-2 aria-selected:text-ink";

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </RD.Overlay>
            <RD.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-3xl border border-line bg-surface shadow-lg"
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
              >
                <RD.Title className="sr-only">ค้นหาและไปยังหน้าต่างๆ</RD.Title>
                <RD.Description className="sr-only">พิมพ์ชื่อหน้า งาน เมนู หรือวัตถุดิบ</RD.Description>
                <Command label="ค้นหาคำสั่ง" loop>
                  <div className="flex items-center gap-3 border-b border-line px-4">
                    <Search className="h-5 w-5 text-ink-3" aria-hidden="true" />
                    <Command.Input autoFocus placeholder="พิมพ์เพื่อค้นหา… เช่น “รับของ” “ลาเต้” “ปิดยอด”" className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3" />
                    <Kbd>Esc</Kbd>
                  </div>
                  <Command.List className="max-h-[55vh] overflow-y-auto p-2 scrollbar-thin">
                    <Command.Empty className="px-3 py-8 text-center text-sm text-ink-3">ไม่พบสิ่งที่ค้นหา ลองคำอื่นดูนะ</Command.Empty>
                    <Command.Group heading="ทำงาน" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
                      {quickActionsFor(access).map((a) => (
                        <Command.Item key={a.key} value={`${a.th} ${a.en} ${a.hint}`} onSelect={() => go(a.href)} className={item}>
                          <Icon name={a.icon} className="h-5 w-5 text-brand" />
                          <span className="flex-1">{a.th}</span>
                          <span className="hidden text-xs text-ink-3 sm:block">{a.hint}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="ไปที่หน้า" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
                      {[...nav.primary, ...nav.more].map((n) => (
                        <Command.Item key={n.key} value={`${n.th} ${n.en}`} onSelect={() => go(n.href)} className={item}>
                          <Icon name={n.icon} className="h-5 w-5" />
                          <span className="flex-1">{n.th}</span>
                          <CornerDownLeft className="h-4 w-4 opacity-40" aria-hidden="true" />
                        </Command.Item>
                      ))}
                    </Command.Group>
                    {can("menu.manage") && (
                      <Command.Group heading="เมนู" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
                        {db.menuItems.map((m) => (
                          <Command.Item key={m.id} value={`เมนู ${m.name}`} onSelect={() => go(`/menu/${m.id}`)} className={item}>
                            <span className="w-5 text-center text-lg" aria-hidden="true">{m.emoji}</span>
                            <span className="flex-1">{m.name}</span>
                            <span className="tabular text-sm text-ink-3">฿{m.price / 100}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {can("inventory.view") && (
                      <Command.Group heading="วัตถุดิบ" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
                        {db.ingredients.filter((i) => i.trackStock).map((i) => (
                          <Command.Item key={i.id} value={`วัตถุดิบ ${i.name}`} onSelect={() => go(`/inventory?q=${encodeURIComponent(i.name)}`)} className={item}>
                            <span className="w-5 text-center text-lg" aria-hidden="true">{i.emoji}</span>
                            <span className="flex-1">{i.name}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </Command.List>
                </Command>
              </motion.div>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}
