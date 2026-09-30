"use client";

import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/app/app-shell";
import { Splash } from "@/components/app/gate";
import { PanelLoading } from "@/components/app/panel-loading";
import { dataSourceMode } from "@/lib/data-source/config";
import { useSabai } from "@/lib/demo/store";

// Only a real shop is opened here; the demo never gets this far, so its download is left until it is wanted.
const loadSignupForm = () => import("@/components/app/signup-form").then((m) => m.SignupForm);
const SignupForm = dynamic(loadSignupForm, { loading: () => <PanelLoading lines={5} /> });
if (typeof window !== "undefined" && dataSourceMode() === "api") void loadSignupForm();

/** Opening a real shop. The sample shop needs no account, so in demo mode this page just sends people to the welcome page. */
export default function SignupPage() {
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
        <motion.section
          aria-labelledby="signup-title"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="glass-overlay mt-8 rounded-[28px] p-5 sm:p-7"
        >
          <SignupForm />
        </motion.section>
      </div>
    </div>
  );
}
