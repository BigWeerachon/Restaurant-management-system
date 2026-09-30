import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@sabai/domain", "@sabai/contracts", "@sabai/observability"],
  reactStrictMode: true,
  // Off by default. `SOURCE_MAPS=1 pnpm build` writes them, for profiling a production build (which source file costs what).
  productionBrowserSourceMaps: process.env.SOURCE_MAPS === "1",
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        // The service worker must never be served from a stale cache, or a fix to it would not reach the till.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
