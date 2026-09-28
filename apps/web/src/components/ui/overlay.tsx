"use client";

import * as RD from "@radix-ui/react-dialog";
import * as RS from "@radix-ui/react-switch";
import * as RT from "@radix-ui/react-tabs";
import * as TT from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Dialog: centred on desktop, bottom sheet on phones (thumb-friendly)
// ---------------------------------------------------------------------------
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
}) {
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </RD.Overlay>
            <RD.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[28px] border border-line bg-surface shadow-lg outline-none",
                  "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px]",
                  width,
                )}
                initial={{ opacity: 0, y: 32, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              >
                <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
                <div className="flex items-start gap-3 px-6 pb-2 pt-4 sm:pt-6">
                  <div className="min-w-0 flex-1">
                    <RD.Title className="text-lg font-semibold text-ink">{title}</RD.Title>
                    {description ? <RD.Description className="mt-1 text-sm text-ink-3">{description}</RD.Description> : <RD.Description className="sr-only">{typeof title === "string" ? title : "หน้าต่าง"}</RD.Description>}
                  </div>
                  {!hideClose && (
                    <RD.Close className="-mr-2 -mt-1 grid h-11 w-11 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="ปิด">
                      <X className="h-5 w-5" />
                    </RD.Close>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 scrollbar-thin">{children}</div>
                {footer && <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
              </motion.div>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------
export function Switch({ checked, onCheckedChange, label, description, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        {description && <span className="block text-sm text-ink-3">{description}</span>}
      </label>
      <RS.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-7 w-12 shrink-0 rounded-full bg-line-strong transition-colors duration-200 data-[state=checked]:bg-brand disabled:opacity-50"
      >
        <RS.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 will-change-transform data-[state=checked]:translate-x-[22px]" />
      </RS.Root>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs with an animated indicator
// ---------------------------------------------------------------------------
export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: ReactNode; count?: number }[];
  children: ReactNode;
  className?: string;
}) {
  const layoutId = useId();
  return (
    <RT.Root value={value} onValueChange={onValueChange} className={className}>
      <RT.List className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="แท็บ">
        {tabs.map((t) => (
          <RT.Trigger
            key={t.value}
            value={t.value}
            className="relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-[15px] font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:text-ink"
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-xs text-ink-2">{t.count}</span>}
            {value === t.value && <motion.span layoutId={layoutId} className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-brand" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          </RT.Trigger>
        ))}
      </RT.List>
      {children}
    </RT.Root>
  );
}
export const TabPanel = RT.Content;

// ---------------------------------------------------------------------------
// Tooltip (desktop hint only — never the only way to learn something)
// ---------------------------------------------------------------------------
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TT.Root delayDuration={250}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content side={side} sideOffset={6} className="z-[60] max-w-64 rounded-lg bg-ink px-2.5 py-1.5 text-[13px] text-ink-inverse shadow-md animate-fade-in">
          {content}
          <TT.Arrow className="fill-ink" />
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}
export const TooltipProvider = TT.Provider;
