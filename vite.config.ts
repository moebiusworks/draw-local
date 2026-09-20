import { defineConfig } from "vite";

const webHost = process.env.DRAW_LOCAL_WEB_HOST ?? "127.0.0.1";
const webPort = Number(process.env.DRAW_LOCAL_WEB_PORT ?? 5173);
const apiPort = Number(process.env.DRAW_LOCAL_PORT ?? 8787);

export default defineConfig({
  server: {
    host: webHost,
    port: webPort,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } }
  },
  build: { outDir: "dist" }
});
