"use client";

import { Check, Delete } from "lucide-react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Animated number — counts to the new value; instant with reduced motion
// ---------------------------------------------------------------------------
export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    if (!inView) return;
    const c = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, inView, reduce, mv]);
  return (
    <motion.span ref={ref} className={className} aria-label={format(value)}>
      {text}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
export function ProgressBar({ value, className, tone = "brand", label }: { value: number; className?: string; tone?: "brand" | "warning" | "danger" | "accent"; label: string }) {
  const color = { brand: "bg-brand", warning: "bg-warning-fill", danger: "bg-danger-fill", accent: "bg-accent" }[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <motion.div className={cn("h-full rounded-full", color)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
    </div>
  );
}

export function ProgressRing({ value, size = 72, stroke = 7, children, label }: { value: number; size?: number; stroke?: number; children?: ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (pct / 100) * c }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard stepper
// ---------------------------------------------------------------------------
export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn("flex items-center gap-2", className)} aria-label="ขั้นตอน">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <motion.span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                done ? "bg-brand text-brand-ink" : active ? "bg-brand-soft text-brand-soft-ink ring-2 ring-brand" : "bg-surface-2 text-ink-3",
              )}
              animate={{ scale: active ? 1.08 : 1 }}
            >
              {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
            </motion.span>
            <span className={cn("hidden truncate text-sm sm:block", active ? "font-semibold text-ink" : "text-ink-3")}>{s}</span>
            {i < steps.length - 1 && <span className={cn("h-0.5 min-w-4 flex-1 rounded-full", done ? "bg-brand" : "bg-line")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Empty state — says what this place is for and the first thing to do
// ---------------------------------------------------------------------------
export function EmptyState({ emoji, title, description, action, secondary, className, compact }: { emoji: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; secondary?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className={cn("relative grid place-items-center rounded-[28px] bg-grain", compact ? "mb-3 h-16 w-16 text-3xl" : "mb-5 h-24 w-24 text-5xl")}>
        <motion.span aria-hidden="true" animate={{ y: [0, -4, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
          {emoji}
        </motion.span>
      </div>
      <h3 className={cn("font-semibold text-ink", compact ? "text-base" : "text-xl")}>{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-[15px] text-ink-3">{description}</p>}
      {(action || secondary) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Numeric keypad — for PINs, quantities and cash (big targets, no keyboard pop-up)
// ---------------------------------------------------------------------------
export function Keypad({ onKey, onBackspace, onClear, decimal, className, size = "md" }: { onKey: (k: string) => void; onBackspace: () => void; onClear?: () => void; decimal?: boolean; className?: string; size?: "md" | "lg" }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const h = size === "lg" ? "h-16 text-2xl" : "h-14 text-xl";
  const btn = cn("grid place-items-center rounded-2xl bg-surface-2 font-semibold text-ink transition-colors hover:bg-surface-3 active:bg-surface-3", h);
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {keys.map((k) => (
        <motion.button key={k} type="button" whileTap={{ scale: 0.92 }} className={btn} onClick={() => onKey(k)}>
          {k}
        </motion.button>
      ))}
      {decimal ? (
        <motion.button type="button" whileTap={{ scale: 0.92 }} className={btn} onClick={() => onKey(".")} aria-label="จุดทศนิยม">
          .
        </motion.button>
      ) : onClear ? (
        <motion.button type="button" whileTap={{ scale: 0.92 }} className={cn(btn, "text-base text-ink-2")} onClick={onClear}>
          ล้าง
        </motion.button>
      ) : (
        <span />
      )}
      <motion.button type="button" whileTap={{ scale: 0.92 }} className={btn} onClick={() => onKey("0")}>
        0
      </motion.button>
      <motion.button type="button" whileTap={{ scale: 0.92 }} className={btn} onClick={onBackspace} aria-label="ลบ">
        <Delete className="h-6 w-6" aria-hidden="true" />
      </motion.button>
    </div>
  );
}

export function PinDots({ length, filled, error }: { length: number; filled: number; error?: boolean }) {
  return (
    <motion.div className="flex justify-center gap-3" animate={error ? { x: [0, -10, 10, -6, 6, 0] } : { x: 0 }} transition={{ duration: 0.4 }} aria-hidden="true">
      {Array.from({ length }, (_, i) => (
        <motion.span
          key={i}
          className={cn("h-4 w-4 rounded-full border-2", error ? "border-danger bg-danger-fill" : i < filled ? "border-brand bg-brand" : "border-line-strong")}
          animate={{ scale: i === filled - 1 ? [1, 1.3, 1] : 1 }}
          transition={{ duration: 0.2 }}
        />
      ))}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Success check — the little moment of delight after paying/saving
// ---------------------------------------------------------------------------
export function SuccessCheck({ size = 88 }: { size?: number }) {
  return (
    <motion.div className="relative grid place-items-center" style={{ width: size, height: size }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
      <motion.span className="absolute inset-0 rounded-full bg-brand-soft" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.25, 1] }} transition={{ duration: 0.6 }} />
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 52 52" className="relative" aria-hidden="true">
        <motion.circle cx="26" cy="26" r="24" fill="var(--brand)" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.05 }} />
        <motion.path d="M15 27 l7 7 l15 -16" fill="none" stroke="var(--brand-ink)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.25, ease: "easeOut" }} />
      </svg>
    </motion.div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} aria-hidden="true" />;
}
