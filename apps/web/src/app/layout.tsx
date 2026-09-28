import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers, themeScript } from "@/components/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sabai — ระบบร้านอาหารที่ใช้สบาย", template: "%s · Sabai" },
  description: "POS ครัว สต็อก สูตรอาหาร จัดซื้อ และการเงิน ในระบบเดียว — รู้ว่าอะไรขายดี ขายที่ไหน ผ่านช่องทางไหน และเหลือเงินจริงเท่าไร",
  applicationName: "Sabai",
  appleWebApp: { capable: true, title: "Sabai", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#11110f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
