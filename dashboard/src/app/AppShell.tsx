import type { ReactNode } from "react";
import type { BufferSource, ClientStatus } from "../shared/api/schemas";
import { Button, StatusBadge, Switch } from "../shared/ui";
import { navItems, type RouteKey, titleForRoute } from "./router";

type AppShellProps = {
  activeRoute: RouteKey;
  bufferSource: BufferSource;
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
        <div className="sidebar__footer">M2 dashboard · Issue #53</div>
      </aside>
      <div className="shell-body">
        <header className="header">
          <div>
            <p className="eyebrow">AsyncScope dashboard</p>
            <h1 className="header__title">{titleForRoute(activeRoute)}</h1>
            {statusReason ? (
              <p className="header__reason">{statusReason}</p>
            ) : null}
          </div>
          <div className="header__actions">
            {statusBadge(status)}
            <StatusBadge
              icon={bufferIcon(bufferSource)}
              tone={bufferTone(bufferSource)}
            >
              {bufferSource}
            </StatusBadge>
            <Switch
              checked={isLightTheme}
              description="Dark가 기본값입니다."
              label="Light theme"
              onCheckedChange={onThemeChange}
            />
            <Button size="sm" variant="ghost">
              Export
            </Button>
          </div>
        </header>
        <main className="main" id="main-content">
          {children}
        </main>
        <footer className="footer">
          <span>route navigation · summary metrics · timeline base</span>
          <span className="footer__links">
            <span>색상 + label + shape</span>
            <span>keyboard first</span>
          </span>
        </footer>
      </div>
    </div>
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
