"use client";

import { Loader2 } from "lucide-react";
import { motion, type HTMLMotionProps } from "motion/react";
import Link from "next/link";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "outline" | "accent";
export type ButtonSize = "sm" | "md" | "lg" | "xl" | "icon" | "icon-lg";

const glossy = "shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.08)]";

const variants: Record<ButtonVariant, string> = {
  primary: `bg-brand text-brand-ink hover:bg-brand-hover ${glossy}`,
  secondary: "glass text-ink hover:shadow-sm",
  outline: "bg-surface/40 text-ink border border-line-strong backdrop-blur-sm hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  soft: "bg-brand-soft text-brand-soft-ink hover:brightness-95",
  danger: `bg-danger-fill text-white hover:brightness-95 ${glossy}`,
  accent: `bg-accent text-on-accent hover:brightness-95 ${glossy}`,
};

// Every size is at least 44px tall (WCAG 2.5.8 AA is 24px; we aim for AAA 44px).
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 min-h-9 px-3.5 text-sm gap-1.5 rounded-full",
  md: "h-11 px-5 text-[15px] gap-2 rounded-full",
  lg: "h-12 px-6 text-base gap-2 rounded-full",
  xl: "h-14 px-7 text-lg gap-2.5 rounded-full",
  icon: "h-11 w-11 rounded-full",
  "icon-lg": "h-14 w-14 rounded-full",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, iconRight, children, className, disabled, block, type = "button", ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,filter] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-[1.1em] w-[1.1em] animate-spin" aria-hidden="true" /> : icon}
      {children}
      {iconRight}
    </motion.button>
  );
});

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  children,
  className,
  block,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  className?: string;
  block?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,filter,transform] duration-150 active:scale-[0.97]",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
    >
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}
