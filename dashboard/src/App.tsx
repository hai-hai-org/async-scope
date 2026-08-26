import { useEffect, useState } from "react";
import { AppShell } from "./app/AppShell";
import { type RouteKey, routeFromHash } from "./app/router";
import { AnalyzerPage } from "./features/analyzer/AnalyzerPage";
import { RequestsPage } from "./features/requests/RequestsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TimelinePage } from "./features/timeline/TimelinePage";
import { fetchExport, fetchSummary } from "./shared/api/client";
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
  const summaryData = payloadOf(summary);
  const exportData = payloadOf(exportState);
  const reload = () => setReloadToken((token) => token + 1);
  const status =
    route === "timeline" && timelineClientStatus
      ? timelineClientStatus
      : (summaryData?.status ??
        (summary.state === "error" ? "disconnected" : "running"));

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
  summary: ApiState<SummaryPayload>;
};

function renderRoute(route: RouteKey, context: RouteContext) {
  if (route === "requests") {
    return <RequestsPage />;
  }
  if (route === "analyzer") {
    return <AnalyzerPage />;
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

function useSummary(reloadToken: number): ApiState<SummaryPayload> {
  const [summary, setSummary] = useState<ApiState<SummaryPayload>>({
    state: "loading",
    data: null,
    error: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken은 본문에서 읽지 않고 다시 요청하라는 신호로만 쓴다.
  useEffect(() => {
    let cancelled = false;
    setSummary({ state: "loading", data: null, error: null });
    fetchSummary()
      .then((payload) => {
        if (cancelled) {
          return;
        }
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
        // 수집값을 만들어내지 않는다. 못 읽었으면 못 읽었다고 표시한다.
        setSummary({
          state: "error",
          data: null,
          error: {
            code: "api_error",
            message: error instanceof Error ? error.message : "summary failed",
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return summary;
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
