import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: "src/lib.ts",
      name: "hodei-client",
      fileName: "hodei-client"
    }
  }
});
