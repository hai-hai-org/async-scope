import { type ReactNode, useState } from "react";
import { downloadExport } from "../shared/api/client";
import type { BufferSource, ClientStatus } from "../shared/api/schemas";
import { Button, StatusBadge, Switch } from "../shared/ui";
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
          <span className="brand__caption">비동기 실행 관제실</span>
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
                <span aria-hidden="true" className="nav-icon">
                  {item.icon}
                </span>
                <span className="nav-label">{item.label}</span>
              </a>
            ))}
          </div>
        </nav>
        <div className="sidebar__footer">
          <p className="sidebar__footer-title">설치 방법</p>
          <pre className="sidebar__snippet">
            <code>
              {"from asyncscope import AsyncScope\nAsyncScope(app).install()"}
            </code>
          </pre>
          <a href={REPO_URL} rel="noreferrer" target="_blank">
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
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
            {bufferSource ? (
              <StatusBadge
                icon={bufferIcon(bufferSource)}
                tone={bufferTone(bufferSource)}
              >
                {bufferSource}
              </StatusBadge>
            ) : null}
            {/* 헤더에서는 설명 줄을 두지 않는다. 토글 상태가 이미 보이고,
                설명 한 줄이 좁은 폭 헤더 높이를 크게 늘린다. 안내는 Settings에 있다. */}
            <Switch
              checked={isLightTheme}
              label="밝은 화면"
              onCheckedChange={onThemeChange}
            />
            <ExportButton />
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
      <Button loading={pending} onClick={save} size="sm" variant="ghost">
        JSON 내보내기
      </Button>
      {error ? (
        <span className="header__error" role="alert">
          {error}
        </span>
      ) : null}
    </>
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
