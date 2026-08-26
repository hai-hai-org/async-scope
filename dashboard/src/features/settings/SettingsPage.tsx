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
      <Panel
        description="runtime settings API를 불러오는 중이다."
        state="loading"
        title="Settings"
      >
        <span />
      </Panel>
    );
  }

  if (settings.state.state === "error" || !payload || !draft) {
    return (
      <Panel
        actions={
          <Button onClick={settings.reload} size="sm" variant="ghost">
            Retry
          </Button>
        }
        description={
          settings.state.state === "error"
            ? settings.state.error
            : "settings payload unavailable"
        }
        title="Settings"
      >
        <EmptyState
          description="AsyncScope 내부 settings API가 응답하지 않으면 form을 표시하지 않는다."
          title="Settings unavailable"
        />
      </Panel>
    );
  }

  return (
    <div className="dashboard-page settings-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">runtime controls</p>
          <h2>Settings</h2>
          <p>
            live setting과 restart-required setting을 분리해서 적용 상태를
            확인한다.
          </p>
        </div>
        <StatusBadge
          icon={payload.tracing ? "●" : "!"}
          tone={payload.tracing ? "success" : "error"}
        >
          tracing {payload.tracing ? "on" : "off"}
        </StatusBadge>
      </section>

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
                Reset
              </Button>
              <Button
                disabled={!dirty || saveState === "saving"}
                loading={saveState === "saving"}
                onClick={saveDraft}
                size="sm"
                variant="primary"
              >
                Save changes
              </Button>
            </div>
          }
          description="변경된 field만 PATCH한다. live field는 즉시 적용되고 restart field는 pending으로 남는다."
          title="Runtime settings"
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
    <section className="settings-status-grid" aria-label="Settings status">
      <StatusCard
        label="Tracing"
        tone={payload.tracing ? "success" : "error"}
        value={payload.tracing ? "running" : "off"}
      />
      <StatusCard
        label="Persistence"
        tone={payload.persisted ? "success" : "inferred"}
        value={payload.persisted ? "persisted" : "process-local"}
      />
      <StatusCard
        label="Pending restart"
        tone={pendingCount ? "warning" : "success"}
        value={`${pendingCount} fields`}
      />
      <StatusCard
        label="Feedback"
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
          <strong>Invalid settings</strong>
          <span>범위와 타입을 고친 뒤 다시 저장한다.</span>
        </div>
      ) : null}
      {serverError ? (
        <div className="settings-alert settings-alert--error" role="alert">
          <strong>Save failed</strong>
          <span>{serverError}</span>
        </div>
      ) : null}

      <div className="settings-form__section">
        <div className="settings-form__section-header">
          <h3>Live settings</h3>
          <p>저장 즉시 heartbeat 수집에 반영된다.</p>
        </div>
        <SettingField
          currentValue={`${payload.settings.threshold_s}s`}
          error={errors.threshold_s}
          help={rangeHelp(payload.limits.threshold_s, "seconds")}
          id="threshold_s"
          label="Blocking threshold"
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
          label="Heartbeat interval"
          onChange={(value) => onChange("interval_s", value)}
          step="0.001"
          type="number"
          value={draft.interval_s}
        />
      </div>

      <div className="settings-form__section">
        <div className="settings-form__section-header">
          <h3>Restart-required settings</h3>
          <p>현재 process에는 바로 적용되지 않고 pending restart로 표시된다.</p>
        </div>
        <SettingField
          currentValue={String(payload.settings.buffer_size)}
          error={errors.buffer_size}
          help={rangeHelp(payload.limits.buffer_size, "events")}
          id="buffer_size"
          label="Buffer size"
          onChange={(value) => onChange("buffer_size", value)}
          pendingValue={pendingValue(payload.pending_restart.buffer_size)}
          step="1"
          type="number"
          value={draft.buffer_size}
        />
        <SettingField
          currentValue={payload.settings.project_root}
          error={errors.project_root}
          help="기존 directory만 허용된다. pending root는 source sandbox를 넓히지 않는다."
          id="project_root"
          label="Project root"
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
        <span>current: {currentValue}</span>
        {pendingValue ? <span>pending restart: {pendingValue}</span> : null}
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
    <Panel description="선택한 theme은 이 browser에 저장된다." title="Theme">
      <div className="settings-theme-panel">
        <Switch
          checked={isLightTheme}
          description="저장값이 없으면 dark로 시작한다."
          label="Light theme"
          onCheckedChange={onThemeChange}
        />
        <p className="field-help">
          현재 theme: {isLightTheme ? "light" : "dark"}
        </p>
      </div>
    </Panel>
  );
}

function GuidePanel() {
  return (
    <Panel
      description="잘못된 설정을 적용된 것처럼 보이지 않게 구분한다."
      title="Settings guide"
    >
      <ul className="settings-guide">
        <li>
          <strong>Live fields</strong>
          <span>threshold와 interval은 저장 즉시 새 heartbeat로 반영된다.</span>
        </li>
        <li>
          <strong>Restart-required fields</strong>
          <span>buffer size와 project root는 pending으로만 기록된다.</span>
        </li>
        <li>
          <strong>Source safety</strong>
          <span>
            pending project root는 source viewer의 sandbox를 넓히지 않는다.
          </span>
        </li>
        <li>
          <strong>Recovery</strong>
          <span>API가 거부한 값은 current나 pending으로 표시하지 않는다.</span>
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
  return <span className="field-help">unsaved changes stay local</span>;
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
  return `allowed range: ${limit.min}–${limit.max} ${unit}`;
}

function pendingValue(value: number | string | undefined) {
  return value == null ? null : String(value);
}
