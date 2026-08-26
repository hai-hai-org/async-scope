import { useCallback, useEffect, useMemo, useState } from "react";
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

/**
 * externalReloadToken: 이 페이지 밖(헤더의 버퍼 비우기 등)에서 데이터가
 * 통째로 바뀌었다는 신호다. 내부 reloadToken(이 페이지의 새로 고침 버튼)과
 * 합쳐서 둘 중 하나만 바뀌어도 다시 읽는다.
 */
export function useRequests(query: RequestsQuery, externalReloadToken = 0) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<RequestsState>({
    state: "loading",
    data: null,
    error: null,
  });
  const requestList = useMemo(
    () => ({ query, reloadToken, externalReloadToken }),
    [query, reloadToken, externalReloadToken],
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

  // identity를 고정한다. 렌더마다 새 함수면 이걸 의존성에 넣은 effect가 루프를 돈다.
  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  return {
    reload,
    state,
  };
}
