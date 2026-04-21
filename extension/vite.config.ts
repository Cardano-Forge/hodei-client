import { copyFile } from "node:fs/promises";
import { defineConfig, type PluginOption } from "vite";

const entryPoints = {
  extension: { clean: true, copyStaticAssets: false },
  injected: { clean: false, copyStaticAssets: true },
};

const entryName = process.env.ENTRY;
if (!entryName) {
  throw new Error("Missing ENTRY env var");
}
if (!(entryName in entryPoints)) {
  throw new Error(
    `Valid values for ENTRY are: ${Object.keys(entryPoints).join(", ")}`,
  );
}
const entry = entryPoints[entryName as keyof typeof entryPoints];

export default defineConfig({
  build: {
    emptyOutDir: entry.clean,
    outDir: "extension/dist",
    lib: {
      entry: `extension/${entryName}.ts`,
      name: entryName,
      fileName: () => `${entryName}.js`,
      formats: ["cjs"],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: entry.copyStaticAssets ? [copyStaticAssets()] : undefined,
});

function copyStaticAssets(): PluginOption {
  let hasGenerated = false;
  return {
    name: "copy-static-assets",
    async writeBundle() {
      if (hasGenerated) {
        return;
      }
      console.log("Copying static assets...");
      hasGenerated = true;
      await copyFile("extension/manifest.json", "extension/dist/manifest.json");
      console.log("\nCopying static assets... done.");
    },
  };
}
