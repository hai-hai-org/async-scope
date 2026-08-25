import type { ReactNode } from "react";
import { Button, Switch } from "../shared/ui";
import { navItems } from "./router";

type AppShellProps = {
  children: ReactNode;
  isLightTheme: boolean;
  onThemeChange: (light: boolean) => void;
};

export function AppShell({
  children,
  isLightTheme,
  onThemeChange,
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
                aria-current={item.key === "overview" ? "page" : undefined}
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
        <div className="sidebar__footer">M2 primitives · Issue #49</div>
      </aside>
      <div className="shell-body">
        <header className="header">
          <div>
            <p className="eyebrow">Day12 primitive showcase</p>
            <h1 className="header__title">Design token과 UI foundation</h1>
          </div>
          <div className="header__actions">
            <Switch
              checked={isLightTheme}
              description="Dark가 기본값입니다."
              label="Light theme"
              onCheckedChange={onThemeChange}
            />
            <Button size="sm" variant="ghost">
              Visual QA 준비
            </Button>
          </div>
        </header>
        <main className="main" id="main-content">
          {children}
        </main>
        <footer className="footer">
          <span>375 · 768 · 1280 · 1536 viewport 기준</span>
          <span className="footer__links">
            <span>색상 + label + shape</span>
            <span>WCAG AA target</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
