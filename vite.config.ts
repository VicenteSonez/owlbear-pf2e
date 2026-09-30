import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// En GitHub Pages la extensión vive en /<repo>/: el workflow define BASE_PATH
// y aquí se reescriben las rutas absolutas del manifest.
function manifestBasePath(): Plugin {
  const base = process.env.BASE_PATH ?? "/";
  return {
    name: "manifest-base-path",
    apply: "build",
    closeBundle() {
      const file = resolve(import.meta.dirname, "dist/manifest.json");
      const fix = (p: string) => (p.startsWith("/") ? base.replace(/\/?$/, "/") + p.slice(1) : p);
      const m = JSON.parse(readFileSync(file, "utf8"));
      m.icon = fix(m.icon);
      m.background_url = fix(m.background_url);
      m.action.icon = fix(m.action.icon);
      m.action.popover = fix(m.action.popover);
      writeFileSync(file, JSON.stringify(m, null, 2));
    },
  };
}

// base relativa: los assets funcionan igual en GitHub Pages y en localhost
export default defineConfig({
  base: "./",
  plugins: [react(), manifestBasePath()],
  server: {
    cors: true,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        background: resolve(import.meta.dirname, "background.html"),
        token: resolve(import.meta.dirname, "token.html"),
      },
    },
  },
  optimizeDeps: {
    exclude: ["@3d-dice/dice-box"],
  },
});
