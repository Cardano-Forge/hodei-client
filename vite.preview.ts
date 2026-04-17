import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        "index.html": "index.html",
      },
    },
  },
  plugins: [basicSsl()],
  server: {
    host: true,
  },
});
