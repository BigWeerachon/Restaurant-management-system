"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Search, X } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ className, children, interactive, as: As = "div", ...rest }: { className?: string; children?: ReactNode; interactive?: boolean; as?: "div" | "section" | "article" } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <As
      className={cn(
        "glass rounded-2xl",
        interactive && "transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

export function CardHeader({ title, description, action, icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3 px-5 pt-5", className)}>
      {icon && <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge — status always pairs colour with an icon or words
// ---------------------------------------------------------------------------
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  brand: "bg-brand-soft text-brand-soft-ink border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  accent: "bg-accent-soft text-accent-ink border-transparent",
};

export function Badge({ tone = "neutral", children, icon, className, dot }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5", toneClass[tone], className)}>
      {dot && <span className="status-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  error,
  children,
  required,
  optional,
  htmlFor,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  required?: boolean;
  optional?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-sm font-medium text-ink">
        {label}
        {required && <span className="text-danger" aria-hidden="true">*</span>}
        {optional && <span className="text-xs font-normal text-ink-3">(ไม่บังคับ)</span>}
      </label>
      {children}
      {error ? (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="flex items-center gap-1.5 text-sm text-danger">
          <OctagonAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </motion.p>
      ) : hint ? (
        <p className="text-[13px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3/80 shadow-xs outline-none transition-[border-color,box-shadow] duration-150 focus:border-brand focus:shadow-[0_0_0_4px_var(--brand-glow)] disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_var(--danger-soft)]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; suffix?: ReactNode; prefix?: ReactNode }>(function Input(
  { className, invalid, suffix, prefix, ...rest },
  ref,
) {
  if (suffix || prefix) {
    return (
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3">{prefix}</span>}
        <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, "h-11", prefix && "pl-9", suffix && "pr-16", className)} {...rest} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-3">{suffix}</span>}
      </div>
    );
  }
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(inputBase, "min-h-20 py-2.5", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(inputBase, "h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b6861' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function SearchInput({ value, onChange, placeholder = "ค้นหา", className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const id = useId();
  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input id={id} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(inputBase, "h-11 pl-10 pr-10")} type="search" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="ล้างคำค้นหา" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (radio group semantics)
// ---------------------------------------------------------------------------
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  size?: "sm" | "md" | "lg";
  className?: string;
  label: string;
}) {
  const layoutId = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 font-medium transition-colors duration-150 disabled:opacity-40",
              size === "sm" ? "h-8 text-[13px]" : size === "lg" ? "h-12 text-base" : "h-10 text-sm",
              active ? "text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            {active && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[10px] bg-surface shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline callouts
// ---------------------------------------------------------------------------
export function Callout({ tone = "info", title, children, action, className }: { tone?: "info" | "success" | "warning" | "danger"; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: OctagonAlert };
  const Ico = icons[tone];
  const cls = { info: "bg-info-soft text-info", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-2xl p-4", cls, className)}>
      <Ico className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("text-ink-2", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-surface-2 px-1 font-sans text-[11px] font-medium text-ink-2">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-line", className)} />;
}

/** Soft background + readable text per person/role colour; the colours are theme tokens, so dark mode follows. */
export const TONE_CLASS: Record<string, string> = {
  violet: "bg-tone-violet text-tone-violet-ink",
  indigo: "bg-tone-indigo text-tone-indigo-ink",
  emerald: "bg-tone-emerald text-tone-emerald-ink",
  sky: "bg-tone-sky text-tone-sky-ink",
  orange: "bg-tone-orange text-tone-orange-ink",
  amber: "bg-tone-amber text-tone-amber-ink",
  rose: "bg-tone-rose text-tone-rose-ink",
};

export function Avatar({ name, color = "emerald", size = 36, className }: { name: string; color?: string; size?: number; className?: string }) {
  const initial = name.replace(/^(คุณ|พี่|น้อง|ป้า|ลุง)/, "").trim().slice(0, 1) || name.slice(0, 1);
  return (
    <span aria-hidden="true" className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold", TONE_CLASS[color] ?? TONE_CLASS.emerald, className)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </span>
  );
}
