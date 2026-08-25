import type { ReactNode } from "react";

type PanelState = "ready" | "loading" | "empty" | "error";

type PanelProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  state?: PanelState;
  stateMessage?: string;
};

export function Panel({
  actions,
  children,
  description,
  state = "ready",
  stateMessage,
  title,
}: PanelProps) {
  return (
    <section className="panel" aria-labelledby={`${panelId(title)}-title`}>
      <div className="panel__header">
        <div>
          <h3 className="panel__title" id={`${panelId(title)}-title`}>
            {title}
          </h3>
          {description ? (
            <p className="panel__description">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="cluster">{actions}</div> : null}
      </div>
      <div className="panel__body">
        {renderPanelBody(state, children, stateMessage)}
      </div>
    </section>
  );
}

function renderPanelBody(
  state: PanelState,
  children: ReactNode,
  stateMessage?: string,
) {
  if (state === "loading") {
    return (
      <div className="panel__state" aria-busy="true">
        <span className="skeleton" />
        <span className="skeleton" style={{ inlineSize: "72%" }} />
        <span>{stateMessage ?? "데이터를 불러오는 중"}</span>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="panel__state">
        <strong>빈 상태</strong>
        <span>{stateMessage ?? "아직 표시할 이벤트가 없습니다."}</span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="panel__state" role="alert">
        <strong>오류 상태</strong>
        <span>
          {stateMessage ?? "다시 시도할 수 있는 복구 경로가 필요합니다."}
        </span>
      </div>
    );
  }
  return children;
}

function panelId(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9가-힣]+/g, "-").replace(/^-|-$/g, "");
}
