import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Identifica cada compilación: las páginas abiertas lo comparan con dist/version.json
// para recargarse solas cuando se publica una versión nueva.
const BUILD_ID = process.env.BUILD_ID ?? Date.now().toString(36);

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
      writeFileSync(resolve(import.meta.dirname, "dist/version.json"), JSON.stringify({ build: BUILD_ID }));
    },
  };
}

// Script en línea al inicio de cada página: recupera la página si sus archivos no cargan
// (HTML viejo en caché tras publicar) y muestra el error si la app se cae sin dibujar nada.
function bootFallback(): Plugin {
  const code = readFileSync(resolve(import.meta.dirname, "src/boot-fallback.js"), "utf8");
  return {
    name: "boot-fallback",
    transformIndexHtml: () => [{ tag: "script", children: code, injectTo: "head-prepend" }],
  };
}

// base relativa: los assets funcionan igual en GitHub Pages y en localhost
export default defineConfig({
  base: "./",
  plugins: [react(), manifestBasePath(), bootFallback()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
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
        toast: resolve(import.meta.dirname, "toast.html"),
      },
    },
  },
  optimizeDeps: {
    exclude: ["@3d-dice/dice-box"],
  },
});
