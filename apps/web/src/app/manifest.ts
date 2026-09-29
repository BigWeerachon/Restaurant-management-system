import type { MetadataRoute } from "next";

/** Lets a tablet install the app to its home screen and open it full-screen, like the till it replaces. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sabai — ระบบร้านอาหาร",
    short_name: "Sabai",
    description: "POS ครัว สต็อก และการเงินของร้านอาหาร ใช้ต่อได้แม้อินเทอร์เน็ตหลุด",
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#f6f5f1",
    icons: [
      { src: "/brand/paakin-icon.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/paakin-icon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
