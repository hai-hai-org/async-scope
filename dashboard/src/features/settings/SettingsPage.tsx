import { useEffect, useMemo, useState } from "react";
import type {
  SettingsLimits,
  SettingsPatch,
  SettingsPayload,
} from "../../shared/api/schemas";
import {
  Button,
  EmptyState,
  Panel,
  StatusBadge,
  Switch,
} from "../../shared/ui";
import { useSettings } from "./useSettings";

type SettingsPageProps = {
  isLightTheme: boolean;
  onThemeChange: (light: boolean) => void;
};

type SettingsDraft = {
  buffer_size: string;
  interval_s: string;
  project_root: string;
  threshold_s: string;
};

type SaveState = "idle" | "saving" | "saved" | "invalid" | "error";

type ValidationErrors = Partial<Record<keyof SettingsDraft, string>>;

export function SettingsPage({
  isLightTheme,
  onThemeChange,
}: SettingsPageProps) {
  const settings = useSettings();
  const payload = settings.state.data;
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (payload) {
      setDraft(draftFromPayload(payload));
    }
  }, [payload]);

  const validationErrors = useMemo(
    () => (draft && payload ? validateDraft(draft, payload.limits) : {}),
    [draft, payload],
  );
  const dirty = Boolean(draft && payload && isDirty(draft, payload));
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const updateDraft = (field: keyof SettingsDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setSaveState("idle");
    setServerError(null);
  };

  const resetDraft = () => {
    if (payload) {
      setDraft(draftFromPayload(payload));
      setSaveState("idle");
      setServerError(null);
    }
  };

  const saveDraft = async () => {
    if (!draft || !payload) {
      return;
    }
    if (hasValidationErrors) {
      setSaveState("invalid");
      return;
    }
    const patch = patchFromDraft(draft, payload);
    if (Object.keys(patch).length === 0) {
      setSaveState("idle");
      return;
    }

    setSaveState("saving");
    setServerError(null);
    try {
      await settings.save(patch);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setServerError(
        error instanceof Error ? error.message : "settings save failed",
      );
    }
  };

  if (settings.state.state === "loading") {
    return (
      <Panel state="loading" title="설정">
        <span />
      </Panel>
    );
  }

  if (settings.state.state === "error" || !payload || !draft) {
    return (
      <Panel
        actions={
          <Button onClick={settings.reload} size="sm" variant="ghost">
            다시 시도
          </Button>
        }
        title="설정"
      >
        <EmptyState
          description="앱이 실행 중인지 확인한 뒤 다시 시도하세요. 값을 잘못 저장하지 않도록 설정 화면을 열지 않습니다."
          title="설정을 불러오지 못했습니다"
        />
      </Panel>
    );
  }

  return (
    <div className="dashboard-page settings-page">
      <RuntimeStatusGrid payload={payload} />

      <section className="settings-layout">
        <Panel
          actions={
            <div className="settings-save-actions">
              <SaveStatus state={saveState} />
              <Button
                disabled={!dirty}
                onClick={resetDraft}
                size="sm"
                variant="ghost"
              >
                되돌리기
              </Button>
              <Button
                disabled={!dirty || saveState === "saving"}
                loading={saveState === "saving"}
                onClick={saveDraft}
                size="sm"
                variant="primary"
              >
                저장
              </Button>
            </div>
          }
          description="즉시 적용되는 항목과 재시작이 필요한 항목이 구분되어 있습니다."
          title="수집 설정"
        >
          <SettingsForm
            draft={draft}
            errors={validationErrors}
            onChange={updateDraft}
            payload={payload}
            serverError={serverError}
            saveState={saveState}
          />
        </Panel>

        <div className="settings-side">
          <ThemePanel
            isLightTheme={isLightTheme}
            onThemeChange={onThemeChange}
          />
          <GuidePanel />
        </div>
      </section>
    </div>
  );
}

function RuntimeStatusGrid({ payload }: { payload: SettingsPayload }) {
  const pendingCount = Object.keys(payload.pending_restart).length;
  return (
    <section className="settings-status-grid" aria-label="설정 상태">
      <StatusCard
        label="수집"
        tone={payload.tracing ? "success" : "error"}
        value={payload.tracing ? "running" : "off"}
      />
      <StatusCard
        label="저장"
        tone={payload.persisted ? "success" : "inferred"}
        value={payload.persisted ? "persisted" : "process-local"}
      />
      <StatusCard
        label="재시작 대기"
        tone={pendingCount ? "warning" : "success"}
        value={`${pendingCount} fields`}
      />
      <StatusCard
        label="피드백"
        tone="observed"
        value={`${payload.feedback.acknowledged} ack · ${payload.feedback.false_positive} false+`}
      />
    </section>
  );
}

function StatusCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "error" | "inferred" | "observed" | "success" | "warning";
  value: string;
}) {
  return (
    <div className="settings-status-card">
      <span>{label}</span>
      <StatusBadge
        icon={tone === "success" ? "✓" : tone === "error" ? "!" : "△"}
        tone={tone}
      >
        {value}
      </StatusBadge>
    </div>
  );
}

function SettingsForm({
  draft,
  errors,
  onChange,
  payload,
  saveState,
  serverError,
}: {
  draft: SettingsDraft;
  errors: ValidationErrors;
  onChange: (field: keyof SettingsDraft, value: string) => void;
  payload: SettingsPayload;
  saveState: SaveState;
  serverError: string | null;
}) {
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      {saveState === "invalid" ? (
        <div className="settings-alert" role="alert">
          <strong>저장할 수 없는 값이 있습니다</strong>
          <span>표시된 항목을 고친 뒤 다시 저장하세요.</span>
        </div>
      ) : null}
      {serverError ? (
        <div className="settings-alert settings-alert--error" role="alert">
          <strong>저장하지 못했습니다</strong>
          <span>{serverError}</span>
        </div>
      ) : null}

      <div className="settings-form__section">
        <div className="settings-form__section-header">
          <h3>즉시 적용되는 항목</h3>
          <p>저장하면 곧바로 적용됩니다.</p>
        </div>
        <SettingField
          currentValue={`${payload.settings.threshold_s}s`}
          error={errors.threshold_s}
          help={rangeHelp(payload.limits.threshold_s, "seconds")}
          id="threshold_s"
          label="블로킹 감지 기준"
          onChange={(value) => onChange("threshold_s", value)}
          step="0.001"
          type="number"
          value={draft.threshold_s}
        />
        <SettingField
          currentValue={`${payload.settings.interval_s}s`}
          error={errors.interval_s}
          help={rangeHelp(payload.limits.interval_s, "seconds")}
          id="interval_s"
          label="측정 주기"
          onChange={(value) => onChange("interval_s", value)}
          step="0.001"
          type="number"
          value={draft.interval_s}
        />
      </div>

      <div className="settings-form__section">
        <div className="settings-form__section-header">
          <h3>재시작이 필요한 항목</h3>
          <p>앱을 다시 시작해야 적용됩니다. 그때까지 대기 상태로 표시됩니다.</p>
        </div>
        <SettingField
          currentValue={String(payload.settings.buffer_size)}
          error={errors.buffer_size}
          help={rangeHelp(payload.limits.buffer_size, "events")}
          id="buffer_size"
          label="버퍼 크기"
          onChange={(value) => onChange("buffer_size", value)}
          pendingValue={pendingValue(payload.pending_restart.buffer_size)}
          step="1"
          type="number"
          value={draft.buffer_size}
        />
        <SettingField
          currentValue={payload.settings.project_root}
          error={errors.project_root}
          help="이미 있는 디렉터리만 지정할 수 있습니다. 재시작 전까지 코드 열람 범위는 넓어지지 않습니다."
          id="project_root"
          label="프로젝트 경로"
          onChange={(value) => onChange("project_root", value)}
          pendingValue={pendingValue(payload.pending_restart.project_root)}
          type="text"
          value={draft.project_root}
        />
      </div>
    </form>
  );
}

function SettingField({
  currentValue,
  error,
  help,
  id,
  label,
  onChange,
  pendingValue,
  step,
  type,
  value,
}: {
  currentValue: string;
  error?: string;
  help: string;
  id: keyof SettingsDraft;
  label: string;
  onChange: (value: string) => void;
  pendingValue?: string | null;
  step?: string;
  type: "number" | "text";
  value: string;
}) {
  const inputId = `settings-${id}`;
  return (
    <div className="settings-field">
      <label htmlFor={inputId}>
        <span>{label}</span>
        <input
          aria-describedby={`${inputId}-help`}
          aria-invalid={Boolean(error)}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          step={step}
          type={type}
          value={value}
        />
      </label>
      <div className="settings-field__meta">
        <span>현재 {currentValue}</span>
        {pendingValue ? <span>재시작 후 {pendingValue}</span> : null}
      </div>
      <p className="field-help" id={`${inputId}-help`}>
        {error ?? help}
      </p>
    </div>
  );
}

function ThemePanel({
  isLightTheme,
  onThemeChange,
}: {
  isLightTheme: boolean;
  onThemeChange: (light: boolean) => void;
}) {
  return (
    <Panel description="이 브라우저에만 저장됩니다." title="화면 테마">
      <div className="settings-theme-panel">
        <Switch
          checked={isLightTheme}
          description="기본값은 어두운 화면입니다."
          label="밝은 화면"
          onCheckedChange={onThemeChange}
        />
        <p className="field-help">
          현재 {isLightTheme ? "밝은 화면" : "어두운 화면"}
        </p>
      </div>
    </Panel>
  );
}

function GuidePanel() {
  return (
    <Panel title="알아두기">
      <ul className="settings-guide">
        <li>
          <strong>즉시 적용</strong>
          <span>감지 기준과 측정 주기는 저장하면 바로 반영됩니다.</span>
        </li>
        <li>
          <strong>재시작 필요</strong>
          <span>
            버퍼 크기와 프로젝트 경로는 앱을 다시 시작한 뒤 적용됩니다.
          </span>
        </li>
        <li>
          <strong>소스 열람 범위</strong>
          <span>재시작 전까지는 코드 열람 범위가 넓어지지 않습니다.</span>
        </li>
        <li>
          <strong>거부된 값</strong>
          <span>저장되지 않은 값은 적용된 것처럼 표시하지 않습니다.</span>
        </li>
      </ul>
    </Panel>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving") {
    return <span className="field-help">saving…</span>;
  }
  if (state === "saved") {
    return (
      <span className="field-help settings-save-status--success">saved</span>
    );
  }
  if (state === "invalid") {
    return (
      <span className="field-help settings-save-status--error">invalid</span>
    );
  }
  if (state === "error") {
    return (
      <span className="field-help settings-save-status--error">error</span>
    );
  }
  return (
    <span className="field-help">
      저장하지 않은 변경은 아직 적용되지 않았습니다.
    </span>
  );
}

function draftFromPayload(payload: SettingsPayload): SettingsDraft {
  return {
    threshold_s: String(payload.settings.threshold_s),
    interval_s: String(payload.settings.interval_s),
    buffer_size: String(
      payload.pending_restart.buffer_size ?? payload.settings.buffer_size,
    ),
    project_root:
      payload.pending_restart.project_root ?? payload.settings.project_root,
  };
}

function isDirty(draft: SettingsDraft, payload: SettingsPayload) {
  const baseline = draftFromPayload(payload);
  return (Object.keys(draft) as (keyof SettingsDraft)[]).some(
    (field) => draft[field] !== baseline[field],
  );
}

function patchFromDraft(
  draft: SettingsDraft,
  payload: SettingsPayload,
): SettingsPatch {
  const baseline = draftFromPayload(payload);
  const patch: SettingsPatch = {};
  if (draft.threshold_s !== baseline.threshold_s) {
    patch.threshold_s = Number(draft.threshold_s);
  }
  if (draft.interval_s !== baseline.interval_s) {
    patch.interval_s = Number(draft.interval_s);
  }
  if (draft.buffer_size !== baseline.buffer_size) {
    patch.buffer_size = Number(draft.buffer_size);
  }
  if (draft.project_root !== baseline.project_root) {
    patch.project_root = draft.project_root.trim();
  }
  return patch;
}

function validateDraft(
  draft: SettingsDraft,
  limits: SettingsLimits,
): ValidationErrors {
  const errors: ValidationErrors = {};
  const threshold = Number(draft.threshold_s);
  if (!validNumber(threshold, limits.threshold_s.min, limits.threshold_s.max)) {
    errors.threshold_s = rangeHelp(limits.threshold_s, "seconds");
  }
  const interval = Number(draft.interval_s);
  if (!validNumber(interval, limits.interval_s.min, limits.interval_s.max)) {
    errors.interval_s = rangeHelp(limits.interval_s, "seconds");
  }
  const bufferSize = Number(draft.buffer_size);
  if (
    !Number.isInteger(bufferSize) ||
    !validNumber(bufferSize, limits.buffer_size.min, limits.buffer_size.max)
  ) {
    errors.buffer_size = rangeHelp(limits.buffer_size, "events");
  }
  if (!draft.project_root.trim()) {
    errors.project_root = "project_root must be a non-empty directory path";
  }
  return errors;
}

function validNumber(value: number, min: number, max: number) {
  return Number.isFinite(value) && min <= value && value <= max;
}

function rangeHelp(
  limit: SettingsLimits["threshold_s" | "buffer_size"],
  unit: string,
) {
  return `허용 범위 ${limit.min}–${limit.max} ${unit}`;
}

function pendingValue(value: number | string | undefined) {
  return value == null ? null : String(value);
}
