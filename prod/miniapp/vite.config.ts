import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Номер сборки: зашивается в код и кладётся рядом в version.json.
// Мини-апп сверяет их, когда снова становится активным, и перезагружается, если вышла новая версия
// (Telegram часто не выгружает мини-апп, а сворачивает — и при открытии показывает старую страницу).
const BUILD_ID = new Date().toISOString();

// base "./" — чтобы сборку можно было положить в любую папку на сервере
export default defineConfig({
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    { name: "vilar-version", generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) }); } },
  ],
  server: { port: 5173 },
});
