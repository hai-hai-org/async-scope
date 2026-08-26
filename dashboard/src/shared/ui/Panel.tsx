import { type ReactNode, useId } from "react";

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
  const titleId = useId();

  return (
    <section className="panel" aria-labelledby={titleId}>
      <div className="panel__header">
        <div>
          <h3 className="panel__title" id={titleId}>
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
        <span>{stateMessage ?? "불러오는 중입니다."}</span>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="panel__state">
        <strong>표시할 데이터가 없습니다</strong>
        <span>{stateMessage ?? "아직 수집된 이벤트가 없습니다."}</span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="panel__state" role="alert">
        <strong>불러오지 못했습니다</strong>
        <span>
          {stateMessage ?? "앱이 실행 중인지 확인한 뒤 다시 시도하세요."}
        </span>
      </div>
    );
  }
  return children;
}
