import { defineConfig } from "tsup";

// Workspace packages ship TypeScript source, so they are bundled into the
// server; npm dependencies stay external and are installed in the image.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: ["@sabai/domain", "@sabai/contracts", "@sabai/observability"],
});
