import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./app/AppShell";
import {
  Button,
  Drawer,
  Panel,
  StatusBadge,
  Table,
  type TableColumn,
} from "./shared/ui";
import { requestRows, uiStateFixtures } from "./test/fixtures";

type RequestRow = (typeof requestRows)[number];

export default function App() {
  const [isLightTheme, setIsLightTheme] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = isLightTheme ? "light" : "dark";
  }, [isLightTheme]);

  const columns = useMemo<Array<TableColumn<RequestRow>>>(
    () => [
      {
        header: "Request",
        key: "path",
        render: (row) => (
          <span className="mono truncate" title={row.path}>
            {row.path}
          </span>
        ),
      },
      {
        header: "Status",
        key: "status",
        render: (row) => statusBadge(row.status),
      },
      {
        header: "Duration",
        key: "duration",
        render: (row) => <span className="mono">{row.duration}</span>,
      },
      {
        header: "Evidence",
        key: "evidence",
        render: (row) =>
          row.evidence === "observed" ? (
            <StatusBadge icon="●" tone="observed">
              observed
            </StatusBadge>
          ) : (
            <StatusBadge icon="△" tone="inferred">
              inferred
            </StatusBadge>
          ),
      },
    ],
    [],
  );

  return (
    <AppShell isLightTheme={isLightTheme} onThemeChange={setIsLightTheme}>
      <div className="showcase" id="showcase">
        <section className="showcase-hero">
          <div>
            <p className="eyebrow">Issue #49 · Day12</p>
            <h2>공통 primitive를 먼저 고정한다</h2>
            <p>
              Timeline, Requests, Analyzer, Settings가 같은 토큰과 상태 문법을
              사용하도록 AppShell, Panel, Button, Switch, Drawer, Table을 한
              화면에서 검증한다.
            </p>
          </div>
          <div className="cluster">
            <StatusBadge icon="●" tone="observed">
              observed는 실선
            </StatusBadge>
            <StatusBadge icon="△" tone="inferred">
              inferred는 점선
            </StatusBadge>
          </div>
        </section>

        <section className="grid grid--three" aria-label="Design tokens">
          <TokenCard
            label="Canvas"
            token="--surface-canvas"
            value="surface hierarchy"
          />
          <TokenCard
            label="Accent"
            token="--accent-primary"
            value="active/focus"
          />
          <TokenCard
            label="Blocking"
            token="--status-error"
            value="warning + label"
          />
        </section>

        <section className="grid grid--two" aria-label="Primitive controls">
          <Panel
            actions={<Button size="sm">Action</Button>}
            description="default, hover, active, focus, disabled, loading 상태를 한 번에 확인한다."
            title="Button"
          >
            <div className="stack">
              <div className="cluster">
                <Button variant="primary">Primary</Button>
                <Button>Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
              </div>
              <div className="cluster">
                <Button className="is-hover">Hover sample</Button>
                <Button className="is-active">Active sample</Button>
                <Button className="is-focus">Focus sample</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Loading</Button>
              </div>
            </div>
          </Panel>

          <Panel
            description="Radix Switch와 Dialog 기반으로 keyboard/focus 동작을 맡긴다."
            title="Switch & Drawer"
          >
            <div className="stack">
              <Drawer
                description="Escape와 닫기 버튼으로 닫히며 focus가 trigger로 돌아와야 한다."
                onOpenChange={setIsDrawerOpen}
                open={isDrawerOpen}
                title="Request detail drawer"
                trigger={<Button variant="primary">Drawer 열기</Button>}
              >
                <div className="stack">
                  <StatusBadge icon="△" tone="inferred">
                    candidate source
                  </StatusBadge>
                  <p>
                    좁은 화면에서는 Timeline detail이 이 drawer 안으로 들어간다.
                    실제 product screen 조립은 Day14 이후 범위다.
                  </p>
                  <pre className="code-sample mono">
                    {`source: examples/demo.py:49
certainty: candidate
next: compare with request spans`}
                  </pre>
                </div>
              </Drawer>
              <div className="state-row">
                <span>Theme toggle</span>
                <span>
                  Header의 Switch로 light/dark token이 바뀐다. 색상 외 border와
                  label도 유지된다.
                </span>
              </div>
            </div>
          </Panel>
        </section>

        <Panel
          description="long path, inferred evidence, selected row와 horizontal overflow를 검증한다."
          title="Table"
        >
          <Table
            caption="Requests primitive sample"
            columns={columns}
            getRowId={(row) => row.id}
            rows={requestRows}
            selectedId="req-2"
          />
        </Panel>

        <section className="grid grid--three" aria-label="UI states">
          <Panel
            description={`schema ${uiStateFixtures.loading.schema_version}`}
            state="loading"
            stateMessage="API 응답 전 skeleton"
            title="Loading"
          >
            <span />
          </Panel>
          <Panel
            description={`requests total ${
              (
                uiStateFixtures.empty.requests.data as {
                  total: number;
                }
              ).total
            }`}
            state="empty"
            stateMessage="API 성공, event buffer는 비어 있음"
            title="Empty"
          >
            <span />
          </Panel>
          <Panel
            description={uiStateFixtures.error.events.error?.code}
            state="error"
            stateMessage="SSE gap 또는 API 실패 복구 상태"
            title="Error"
          >
            <span />
          </Panel>
        </section>

        <Panel
          description="색상만으로 상태를 전달하지 않고 text/icon/border style을 함께 사용한다."
          title="Status and evidence"
        >
          <div className="stack">
            <div className="state-row">
              <StatusBadge icon="▶" tone="success">
                running
              </StatusBadge>
              <span>상태명과 icon을 함께 제공한다.</span>
            </div>
            <div className="state-row">
              <StatusBadge icon="●" tone="observed">
                observed
              </StatusBadge>
              <span>collector/API가 직접 관측한 값은 실선 badge다.</span>
            </div>
            <div className="state-row">
              <StatusBadge icon="△" tone="inferred">
                inferred
              </StatusBadge>
              <span>
                분석에서 추론한 값은 점선 badge와 candidate 문구를 쓴다.
              </span>
            </div>
            <div className="state-row">
              <StatusBadge icon="!" tone="error">
                blocking
              </StatusBadge>
              <span>
                blocking은 빨간색만 쓰지 않고 warning icon과 label을 같이 둔다.
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function TokenCard({
  label,
  token,
  value,
}: {
  label: string;
  token: string;
  value: string;
}) {
  return (
    <article className="token-card">
      <span
        className="token-card__sample"
        style={{ background: `var(${token})` }}
      />
      <strong>{label}</strong>
      <span className="mono">{token}</span>
      <span className="field-help">{value}</span>
    </article>
  );
}

function statusBadge(status: string) {
  if (status === "completed") {
    return (
      <StatusBadge icon="✓" tone="success">
        completed
      </StatusBadge>
    );
  }
  if (status === "blocking") {
    return (
      <StatusBadge icon="!" tone="error">
        blocking
      </StatusBadge>
    );
  }
  return (
    <StatusBadge icon="▶" tone="observed">
      running
    </StatusBadge>
  );
}
