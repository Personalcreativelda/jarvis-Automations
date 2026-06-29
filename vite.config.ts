// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

function loadDevVars(): Record<string, string> {
  try {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const content = readFileSync(resolve(dir, ".dev.vars"), "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return result;
  } catch {
    return {};
  }
}

const devVars = loadDevVars();

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: Object.fromEntries(
      Object.entries(devVars).map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
    ),
    preview: {
      allowedHosts: "all",
    },
    server: {
      proxy: {
        "/jarvis-agent": {
          target: "http://127.0.0.1:4000",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/jarvis-agent/, ""),
        },
      },
    },
  },
});
