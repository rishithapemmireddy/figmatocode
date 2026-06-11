import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/figma-api": {
        target: "https://api.figma.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/figma-api/, "")
      }
    }
  }
});
