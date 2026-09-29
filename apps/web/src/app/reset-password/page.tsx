"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/app/app-shell";
import { Splash } from "@/components/app/gate";
import { ResetPasswordForm } from "@/components/app/reset-password-form";
import { dataSourceMode } from "@/lib/data-source/config";
import { useSabai } from "@/lib/demo/store";

export default function ResetPasswordPage() {
  const hydrated = useSabai((s) => s.hydrated);
  const router = useRouter();
  const api = dataSourceMode() === "api";

  useEffect(() => {
    if (hydrated && !api) router.replace("/");
  }, [hydrated, api, router]);

  if (!hydrated || !api) return <Splash />;
  return (
    <div className="glass-field relative min-h-dvh bg-bg">
      <div className="mx-auto max-w-xl px-5 py-10">
        <Logo />
        <motion.section aria-labelledby="reset-title" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="glass-overlay mt-8 rounded-[28px] p-5 sm:p-7">
          <ResetPasswordForm />
        </motion.section>
      </div>
    </div>
  );
}
