"use client";

import { MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/overlay";
import { dataSourceMode } from "@/lib/data-source/config";
import { ApprovalDialog } from "./approval-dialog";
import { ErrorReporting } from "./error-reporting";
import { PrinterBridge } from "./printer-bridge";
import { PrintRoot } from "./print-root";
import { ServiceWorkerRegister } from "./service-worker-register";
import { SwitchUserDialog } from "./switch-user-dialog";

/** The server-facing parts (see `api-bridges.tsx`): a download of their own, fetched in API mode only. */
const loadApiBridges = () => import("./api-bridges");
const ApiBridges = dynamic(loadApiBridges, { ssr: false });
// Start the download as soon as this file runs, not when the first screen has rendered: the shop refresh waits for it.
if (typeof window !== "undefined" && dataSourceMode() === "api") void loadApiBridges();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        {children}
        {dataSourceMode() === "api" && <ApiBridges />}
        <ErrorReporting />
        <ServiceWorkerRegister />
        <PrintRoot />
        <PrinterBridge />
        <ApprovalDialog />
        <SwitchUserDialog />
        <Toaster
          position="top-center"
          gap={8}
          toastOptions={{
            classNames: {
              toast: "!rounded-2xl !border !border-line !bg-surface !text-ink !shadow-lg !font-sans !text-[15px] !px-4 !py-3.5",
              title: "!font-semibold",
              description: "!text-ink-2 !text-sm",
              actionButton: "!bg-brand !text-brand-ink !rounded-lg !font-medium",
              success: "[&_[data-icon]]:!text-success",
              error: "[&_[data-icon]]:!text-danger",
            },
          }}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}

/** Applied before paint to avoid a light/dark flash. */
export const themeScript = `(function(){try{var t=localStorage.getItem('sabai-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
