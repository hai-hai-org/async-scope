import { useEffect, useMemo, useState } from "react";
import { fetchFindings } from "../../shared/api/client";
import type {
  FindingsListPayload,
  FindingsQuery,
} from "../../shared/api/schemas";

export type FindingsState =
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: FindingsListPayload; error: null }
  | { state: "empty"; data: FindingsListPayload; error: null }
  | { state: "error"; data: null; error: string };

export const DEFAULT_FINDINGS_QUERY: FindingsQuery = {
  page: 1,
  page_size: 50,
};

export function useFindings(query: FindingsQuery) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<FindingsState>({
    state: "loading",
    data: null,
    error: null,
  });
  const findingsRequest = useMemo(
    () => ({ query, reloadToken }),
    [query, reloadToken],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ state: "loading", data: null, error: null });
    fetchFindings(findingsRequest.query)
      .then((payload) => {
        if (!cancelled) {
          setState({
            state: payload.items.length ? "ready" : "empty",
            data: payload,
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            state: "error",
            data: null,
            error: error instanceof Error ? error.message : "findings failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [findingsRequest]);

  return {
    reload: () => setReloadToken((value) => value + 1),
    state,
  };
}
