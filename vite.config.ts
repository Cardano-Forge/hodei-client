/// <reference types="vitest/config" />
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/lib.ts",
      name: "hodei",
      fileName: "lib",
    },
  },
  plugins: [dts({ bundleTypes: true })],
  test: {
    environment: "happy-dom",
    globals: true,
  },
});
