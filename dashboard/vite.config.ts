import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// dev에서 대시보드는 :5173, 대상 app과 내부 API는 :8000에서 뜬다.
// 실제 설치본에서는 같은 origin이므로 이 proxy는 개발 편의용이다.
const TARGET = process.env.ASYNCSCOPE_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/__asyncscope__": {
        target: TARGET,
        changeOrigin: true,
        // SSE는 응답을 모아두면 안 된다. 프레임이 오는 즉시 흘려보낸다.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (
              proxyRes.headers["content-type"]?.includes("text/event-stream")
            ) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
            }
          });
        },
      },
    },
  },
});
