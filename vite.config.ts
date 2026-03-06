/// <reference types="vitest/config" />
import { copyFile, writeFile } from "node:fs/promises";
import dts from "unplugin-dts/vite";
import { defineConfig, type PluginOption } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  build: {
    lib: {
      entry: "src/lib.ts",
      name: "Hodei",
      fileName: "lib",
    },
  },
  plugins: [
    dts({
      bundleTypes: true,
    }),
    copyPackageJson(),
  ],
  test: {
    environment: "happy-dom",
    globals: true,
  },
});

function copyPackageJson(): PluginOption {
  let hasGenerated = false;
  return {
    name: "copy-package-json",
    async writeBundle() {
      if (hasGenerated) {
        return;
      }
      hasGenerated = true;
      await Promise.all([
        writeFile(
          "dist/package.json",
          JSON.stringify(
            {
              ...pkg,
              files: ["**"],
              main: "./lib.umd.cjs",
              module: "./lib.js",
              types: "./lib.d.ts",
              exports: {
                ".": {
                  types: "./lib.d.ts",
                  import: "./lib.js",
                  require: "./lib.umd.cjs",
                },
              },
            },
            null,
            2,
          ),
        ),
        copyFile("./README.md", "dist/README.md"),
        copyFile("./LICENSE", "dist/LICENSE"),
      ]);
    },
  };
}
