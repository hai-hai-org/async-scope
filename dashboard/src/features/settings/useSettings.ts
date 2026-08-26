import { useEffect, useMemo, useState } from "react";
import { fetchSettings, patchSettings } from "../../shared/api/client";
import type { SettingsPatch, SettingsPayload } from "../../shared/api/schemas";

export type SettingsState =
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: SettingsPayload; error: null }
  | { state: "error"; data: null; error: string };

export function useSettings() {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<SettingsState>({
    state: "loading",
    data: null,
    error: null,
  });
  const settingsRequest = useMemo(() => ({ reloadToken }), [reloadToken]);

  useEffect(() => {
    const currentReloadToken = settingsRequest.reloadToken;
    void currentReloadToken;

    let cancelled = false;
    setState({ state: "loading", data: null, error: null });
    fetchSettings()
      .then((payload) => {
        if (!cancelled) {
          setState({ state: "ready", data: payload, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            state: "error",
            data: null,
            error: error instanceof Error ? error.message : "settings failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [settingsRequest]);

  const save = async (patch: SettingsPatch) => {
    const payload = await patchSettings(patch);
    setState({ state: "ready", data: payload, error: null });
    return payload;
  };

  return {
    reload: () => setReloadToken((value) => value + 1),
    save,
    state,
  };
}
