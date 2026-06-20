import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// 开发期：5173 代理后端 8000；生产：build 输出到 ../static，base=/static/ 匹配 FastAPI 挂载点
export default defineConfig({
  plugins: [preact()],
  base: "/static/",
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
