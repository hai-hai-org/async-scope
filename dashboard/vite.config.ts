import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// dev에서 대시보드는 :5173, 대상 app과 내부 API는 :8000에서 뜬다.
// 실제 설치본에서는 같은 origin이므로 이 proxy는 개발 편의용이다.
const TARGET = process.env.ASYNCSCOPE_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  // 설치본에서 대시보드는 /__asyncscope__/ 아래에 붙는다. 상대 base는 build에만
  // 적용되고 dev server는 "/"로 되돌리므로, 아래 proxy 규칙과 충돌하지 않는다.
  base: "./",
  build: {
    // 빌드 결과를 바로 패키지 안으로 떨군다 (복사 단계 없음). .gitignore에 예약돼 있다.
    outDir: "../src/asyncscope/web/static",
    emptyOutDir: true, // root 밖이라 명시해야 청소한다
  },
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
