import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/.pnpm/recharts") ||
            id.includes("/node_modules/.pnpm/d3-") ||
            id.includes("/node_modules/.pnpm/react-smooth") ||
            id.includes("/node_modules/.pnpm/decimal.js-light")
          ) {
            return "charts";
          }
          if (
            id.includes("/node_modules/.pnpm/react@") ||
            id.includes("/node_modules/.pnpm/react-dom@") ||
            id.includes("/node_modules/.pnpm/scheduler@")
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
