import { useEffect, useState } from "react";
import { AppShell } from "./app/AppShell";
import { type RouteKey, routeFromHash } from "./app/router";
import { AnalyzerPage } from "./features/analyzer/AnalyzerPage";
import { RequestsPage } from "./features/requests/RequestsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TimelinePage } from "./features/timeline/TimelinePage";
import {
  clearBuffer as clearBufferApi,
  fetchExport,
  fetchSummary,
} from "./shared/api/client";
import { type ClockAnchor, clockAnchorFrom } from "./shared/api/eventStore";
import type {
  ApiState,
  ClientStatus,
  ExportPayload,
  SummaryPayload,
} from "./shared/api/schemas";

const THEME_STORAGE_KEY = "asyncscope.theme";

export default function App() {
  const [isLightTheme, setIsLightTheme] = useState(() => initialLightTheme());
  const [timelineClientStatus, setTimelineClientStatus] =
    useState<ClientStatus | null>(null);
  const route = useHashRoute();
  const [reloadToken, setReloadToken] = useState(0);
  const summary = useSummary(reloadToken);
  const exportState = useExport(reloadToken);
  const summaryData = payloadOf(summary.state);
  const exportData = payloadOf(exportState);
  const reload = () => setReloadToken((token) => token + 1);
  // 서버 buffer를 비운 뒤 summary·export를 즉시 다시 읽는다 — 다음 폴링(2초)까지
  // 기다리면 방금 비웠는데도 화면에 옛 값이 잠깐 남아 "안 비워졌나?" 하게 된다.
  // Timeline 자체 스트림은 서버가 보내는 gap(§TimelinePage handleGap)으로
  // 알아서 다시 붙는다 — 여기서 그 페이지의 상태까지 알 필요가 없다.
  const clearBuffer = async () => {
    await clearBufferApi();
    reload();
  };
  const status =
    route === "timeline" && timelineClientStatus
      ? timelineClientStatus
      : (summaryData?.status ??
        (summary.state.state === "error" ? "disconnected" : "running"));

  useEffect(() => {
    const theme = isLightTheme ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage가 막혀도 theme 적용 자체는 유지한다.
    }
  }, [isLightTheme]);

  return (
    <AppShell
      activeRoute={route}
      bufferSource={summaryData?.buffer.source ?? exportData?.buffer.source}
      isLightTheme={isLightTheme}
      onClearBuffer={clearBuffer}
      onThemeChange={setIsLightTheme}
      status={status}
      statusReason={summaryData?.status_reason}
    >
      {renderRoute(route, {
        exportState,
        isLightTheme,
        onClientStatusChange: setTimelineClientStatus,
        onRetry: reload,
        onThemeChange: setIsLightTheme,
        reloadToken,
        summary,
      })}
    </AppShell>
  );
}

type RouteContext = {
  exportState: ApiState<ExportPayload>;
  isLightTheme: boolean;
  onClientStatusChange: (status: ClientStatus | null) => void;
  onRetry: () => void;
  onThemeChange: (light: boolean) => void;
  /** 버퍼 비우기 등 페이지 밖에서 일어난 변경을 알리는 신호. 값 자체는 의미가
   * 없고 바뀌었다는 사실만 쓴다 — 각 페이지의 데이터 hook에 그대로 흘려보낸다. */
  reloadToken: number;
  summary: SummaryState;
};

function renderRoute(route: RouteKey, context: RouteContext) {
  if (route === "requests") {
    return (
      <RequestsPage
        clockAnchor={context.summary.anchor}
        reloadToken={context.reloadToken}
      />
    );
  }
  if (route === "analyzer") {
    return <AnalyzerPage reloadToken={context.reloadToken} />;
  }
  if (route === "settings") {
    return (
      <SettingsPage
        isLightTheme={context.isLightTheme}
        onThemeChange={context.onThemeChange}
      />
    );
  }
  return (
    <TimelinePage
      exportState={context.exportState}
      onClientStatusChange={context.onClientStatusChange}
      onRetry={context.onRetry}
      summary={context.summary}
    />
  );
}

function payloadOf<T>(state: ApiState<T>): T | null {
  return state.state === "ready" || state.state === "empty" ? state.data : null;
}

function initialLightTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light";
  } catch {
    return false;
  }
}

function useHashRoute(): RouteKey {
  const [route, setRoute] = useState<RouteKey>(() =>
    routeFromHash(window.location.hash),
  );

  useEffect(() => {
    const sync = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    if (!window.location.hash) {
      window.location.replace("#/timeline");
    }
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return route;
}

/** 지표를 이 주기로 다시 읽는다. summary는 메모리 집계라 비용이 낮다. */
const SUMMARY_POLL_MS = 2000;

export type SummaryState = {
  state: ApiState<SummaryPayload>;
  /** 마지막 조회가 실패해 이전 값을 그대로 보여주는 중인가. */
  isStale: boolean;
  /**
   * event 시각을 벽시계로 옮기는 기준점. 폴링마다 갱신되므로 프로세스가
   * 잠깐 멈춰 두 시계가 벌어져도 오차가 폴링 주기 안으로 유지된다.
   */
  anchor: ClockAnchor | null;
};

function useSummary(reloadToken: number): SummaryState {
  const [summary, setSummary] = useState<ApiState<SummaryPayload>>({
    state: "loading",
    data: null,
    error: null,
  });
  const [isStale, setIsStale] = useState(false);
  const [anchor, setAnchor] = useState<ClockAnchor | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken은 본문에서 읽지 않고 다시 요청하라는 신호로만 쓴다.
  useEffect(() => {
    let cancelled = false;
    let hasData = false;

    const load = () => {
      if (document.visibilityState === "hidden") {
        // 탭이 숨은 동안 대상 앱의 event loop를 깨우지 않는다.
        return;
      }
      fetchSummary()
        .then((payload) => {
          if (cancelled) {
            return;
          }
          hasData = true;
          setIsStale(false);
          setAnchor(clockAnchorFrom(payload));
          setSummary({
            state: payload.buffer.events === 0 ? "empty" : "ready",
            data: payload,
            error: null,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          if (hasData) {
            // 값을 지우면 깜빡이고, 옛 값을 live라고 하면 거짓이다.
            // 마지막으로 읽은 값을 남기되 갱신되지 않았음을 표시한다.
            setIsStale(true);
            return;
          }
          // 아직 한 번도 못 읽었다. 수집값을 만들어내지 않는다.
          setSummary({
            state: "error",
            data: null,
            error: {
              code: "api_error",
              message:
                error instanceof Error ? error.message : "summary failed",
            },
          });
        });
    };

    setSummary({ state: "loading", data: null, error: null });
    setIsStale(false);
    setAnchor(null);
    load();

    const timer = window.setInterval(load, SUMMARY_POLL_MS);
    // 탭으로 돌아왔을 때 다음 tick까지 옛 값을 보여주지 않는다.
    document.addEventListener("visibilitychange", load);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [reloadToken]);

  return { state: summary, isStale, anchor };
}

function useExport(reloadToken: number): ApiState<ExportPayload> {
  const [exportState, setExportState] = useState<ApiState<ExportPayload>>({
    state: "loading",
    data: null,
    error: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken은 본문에서 읽지 않고 다시 요청하라는 신호로만 쓴다.
  useEffect(() => {
    let cancelled = false;
    setExportState({ state: "loading", data: null, error: null });
    fetchExport()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setExportState({
          state: payload.events.length === 0 ? "empty" : "ready",
          data: payload,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setExportState({
          state: "error",
          data: null,
          error: {
            code: "api_error",
            message: error instanceof Error ? error.message : "export failed",
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return exportState;
}
