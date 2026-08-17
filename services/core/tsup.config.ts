import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  external: ["node:sqlite", "playwright-core", "ws", "yaml", "zod"],
  noExternal: [/^@jarvis\//],
});
