import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  preview: {
    port: 3000,
    host: true,
    allowedHosts: "all",
  },
  build: {
    outDir: "dist",
  },
});
