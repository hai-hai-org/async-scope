import { useEffect, useState } from "react";
import { AppShell } from "./app/AppShell";
import { OverviewPage } from "./app/OverviewPage";
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
import { fallbackExport, fallbackSummary } from "./test/fixtures";

const THEME_STORAGE_KEY = "asyncscope.theme";

export default function App() {
  const [isLightTheme, setIsLightTheme] = useState(() => initialLightTheme());
  const [timelineClientStatus, setTimelineClientStatus] =
    useState<ClientStatus | null>(null);
  const [route] = useHashRoute();
  const summary = useSummary();
  const exportState = useExport();
  const summaryData =
    summary.state === "ready" || summary.state === "empty"
      ? summary.data
      : null;
  const exportData =
    exportState.state === "ready" || exportState.state === "empty"
      ? exportState.data
      : fallbackExport;
  const timelineEvents =
    exportState.state === "ready" || exportState.state === "empty"
      ? exportState.data.events
      : undefined;
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
      bufferSource={summaryData?.buffer.source ?? exportData.buffer.source}
      isLightTheme={isLightTheme}
      onThemeChange={setIsLightTheme}
      status={status}
      statusReason={summaryData?.status_reason}
    >
      {renderRoute(
        route,
        summary,
        exportData,
        timelineEvents,
        {
          onClientStatusChange: setTimelineClientStatus,
        },
        {
          isLightTheme,
          onThemeChange: setIsLightTheme,
        },
      )}
    </AppShell>
  );
}

function renderRoute(
  route: RouteKey,
  summary: ApiState<SummaryPayload>,
  exportData: ExportPayload,
  timelineEvents: ExportPayload["events"] | undefined,
  timelineOptions: {
    onClientStatusChange: (status: ClientStatus | null) => void;
  },
  themeOptions: {
    isLightTheme: boolean;
    onThemeChange: (light: boolean) => void;
  },
) {
  if (route === "timeline") {
    return (
      <TimelinePage
        bufferSource={exportData.buffer.source}
        events={timelineEvents}
        onClientStatusChange={timelineOptions.onClientStatusChange}
      />
    );
  }
  if (route === "requests") {
    return <RequestsPage />;
  }
  if (route === "analyzer") {
    return <AnalyzerPage />;
  }
  if (route === "settings") {
    return (
      <SettingsPage
        isLightTheme={themeOptions.isLightTheme}
        onThemeChange={themeOptions.onThemeChange}
      />
    );
  }
  return <OverviewPage summary={summary} />;
}

function initialLightTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light";
  } catch {
    return false;
  }
}

function useHashRoute(): [RouteKey, (route: RouteKey) => void] {
  const [route, setRoute] = useState<RouteKey>(() =>
    routeFromHash(window.location.hash),
  );

  useEffect(() => {
    const sync = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    if (!window.location.hash) {
      window.location.replace("#/overview");
    }
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = (nextRoute: RouteKey) => {
    window.location.hash = `/${nextRoute}`;
    setRoute(nextRoute);
  };

  return [route, navigate];
}

function useSummary(): ApiState<SummaryPayload> {
  const [summary, setSummary] = useState<ApiState<SummaryPayload>>({
    state: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
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
        setSummary({
          state: "ready",
          data: {
            ...fallbackSummary,
            status_reason:
              error instanceof Error
                ? `fixture fallback: ${error.message}`
                : "fixture fallback",
          },
          error: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return summary;
}

function useExport(): ApiState<ExportPayload> {
  const [exportState, setExportState] = useState<ApiState<ExportPayload>>({
    state: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return exportState;
}
