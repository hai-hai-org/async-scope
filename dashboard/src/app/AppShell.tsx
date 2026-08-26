import { type ReactNode, useState } from "react";
import { downloadExport } from "../shared/api/client";
import type { BufferSource, ClientStatus } from "../shared/api/schemas";
import { Button, StatusBadge, Tooltip, TooltipProvider } from "../shared/ui";
import {
  descriptionForRoute,
  navItems,
  type RouteKey,
  titleForRoute,
} from "./router";

const REPO_URL = "https://github.com/hai-hai-org/async-scope";
const VERSION = "0.1.0";

type AppShellProps = {
  activeRoute: RouteKey;
  bufferSource?: BufferSource;
  children: ReactNode;
  isLightTheme: boolean;
  onThemeChange: (light: boolean) => void;
  status: ClientStatus;
  statusReason?: string | null;
};

export function AppShell({
  activeRoute,
  bufferSource,
  children,
  isLightTheme,
  onThemeChange,
  status,
  statusReason,
}: AppShellProps) {
  return (
    <TooltipProvider>
      <div className="app-shell">
        <a className="skip-link button button--primary" href="#main-content">
          본문으로 건너뛰기
        </a>
        <aside className="sidebar" aria-label="AsyncScope navigation">
          <div className="brand">
            <div className="brand__mark">
              <span aria-hidden="true" className="brand__glyph">
                ∞
              </span>
              <span className="brand__text">AsyncScope</span>
            </div>
            <span className="brand__caption">Make Async Visible</span>
          </div>
          <nav aria-label="Primary">
            <div className="nav-list">
              {navItems.map((item) => (
                <a
                  aria-current={item.key === activeRoute ? "page" : undefined}
                  className="nav-item"
                  href={item.href}
                  key={item.key}
                >
                  <span className="nav-label">{item.label}</span>
                </a>
              ))}
            </div>
          </nav>
        </aside>
        <div className="shell-body">
          <header className="header">
            <div className="header__heading">
              <h1 className="header__title">{titleForRoute(activeRoute)}</h1>
              <p className="header__description">
                {descriptionForRoute(activeRoute)}
              </p>
              {statusReason ? (
                <p className="header__reason">{statusReason}</p>
              ) : null}
            </div>
            <div className="header__actions">
              {statusBadge(status)}
              {/* live일 때는 알려 줄 것이 없다 — 상태 배지가 이미 running을 말한다.
                평상시 헤더를 비워 두고, 재생·혼합 버퍼일 때만 신호를 낸다. */}
              {bufferSource && bufferSource !== "live" ? (
                <StatusBadge
                  icon={bufferIcon(bufferSource)}
                  tone={bufferTone(bufferSource)}
                >
                  {bufferSource}
                </StatusBadge>
              ) : null}
              {/* 컨트롤은 따로 묶는다. 배지와 같은 wrap 컨테이너에 두면 폭에 따라
                토글과 버튼이 서로 다른 줄로 갈라진다. */}
              <div className="header__controls">
                <ThemeToggle
                  isLightTheme={isLightTheme}
                  onChange={onThemeChange}
                />
                <ExportButton />
              </div>
            </div>
          </header>
          <main className="main" id="main-content">
            {children}
          </main>
          <footer className="footer">
            <span>AsyncScope v{VERSION}</span>
            <span className="footer__links">
              <a href={REPO_URL} rel="noreferrer" target="_blank">
                GitHub <span aria-hidden="true">↗</span>
              </a>
            </span>
          </footer>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ExportButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await downloadExport();
    } catch {
      setError("내보내지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Tooltip label="현재 버퍼에 있는 이벤트 전체를 JSON 파일로 내려받습니다.">
        <Button loading={pending} onClick={save} size="sm" variant="ghost">
          JSON export
        </Button>
      </Tooltip>
      {error ? (
        <span className="header__error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

type ThemeToggleProps = {
  isLightTheme: boolean;
  onChange: (light: boolean) => void;
};

/**
 * label 텍스트 없이 아이콘만으로 상태를 보인다 — 아이콘은 지금 켜져 있는 화면이
 * 아니라 눌렀을 때 바뀔 화면을 가리킨다(기본값이 어두운 화면이므로 처음엔 해가
 * 보이고, 누르면 밝은 화면이 되면서 달로 바뀐다). icon-only이므로 accessible
 * name(aria-label)과 별개로 visible tooltip을 함께 둔다 (DESIGN.md §8).
 */
function ThemeToggle({ isLightTheme, onChange }: ThemeToggleProps) {
  const label = isLightTheme ? "dark mode로 전환" : "light mode로 전환";

  return (
    <Tooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isLightTheme}
        className="button--icon"
        onClick={() => onChange(!isLightTheme)}
        size="sm"
        variant="ghost"
      >
        <span aria-hidden="true">{isLightTheme ? "☾" : "☀"}</span>
      </Button>
    </Tooltip>
  );
}

function statusBadge(status: ClientStatus) {
  if (status === "running") {
    return (
      <StatusBadge icon="●" tone="success">
        running
      </StatusBadge>
    );
  }
  if (status === "unsupported" || status === "disconnected") {
    return (
      <StatusBadge icon="!" tone="error">
        {status}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge icon="△" tone="inferred">
      {status}
    </StatusBadge>
  );
}

function bufferTone(source: BufferSource) {
  if (source === "live") {
    return "observed";
  }
  if (source === "mixed") {
    return "error";
  }
  return "inferred";
}

function bufferIcon(source: BufferSource) {
  if (source === "live") {
    return "●";
  }
  if (source === "mixed") {
    return "!";
  }
  return "↺";
}
