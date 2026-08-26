import { useEffect, useMemo, useState } from "react";
import { fetchRequests } from "../../shared/api/client";
import type {
  RequestsListPayload,
  RequestsQuery,
} from "../../shared/api/schemas";

export type RequestsState =
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: RequestsListPayload; error: null }
  | { state: "empty"; data: RequestsListPayload; error: null }
  | { state: "error"; data: null; error: string };

export const DEFAULT_REQUESTS_QUERY: RequestsQuery = {
  order: "desc",
  page: 1,
  page_size: 50,
  sort: "started_at_ns",
};

export function useRequests(query: RequestsQuery) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<RequestsState>({
    state: "loading",
    data: null,
    error: null,
  });
  const requestList = useMemo(
    () => ({ query, reloadToken }),
    [query, reloadToken],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ state: "loading", data: null, error: null });
    fetchRequests(requestList.query)
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
            error: error instanceof Error ? error.message : "requests failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [requestList]);

  return {
    reload: () => setReloadToken((value) => value + 1),
    state,
  };
}
