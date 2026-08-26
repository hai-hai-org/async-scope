import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchFindings } from "./client";
import type { FindingsListPayload, FindingsQuery } from "./schemas";

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

  const lastQuery = useRef(query);

  useEffect(() => {
    let cancelled = false;
    // query가 바뀌면 이전 결과는 틀린 것이므로 비운다. 같은 query를 다시 읽는
    // 것(reload)일 때는 값을 유지한다 — 비우면 화면이 깜빡인다.
    const queryChanged = lastQuery.current !== findingsRequest.query;
    lastQuery.current = findingsRequest.query;
    if (queryChanged) {
      setState({ state: "loading", data: null, error: null });
    }
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

  // identity를 고정한다. 렌더마다 새 함수를 주면 이걸 의존성에 넣은 effect가
  // 무한 루프를 돈다 (실제로 4초에 findings 요청 1만 건을 만들었다).
  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  return { reload, state };
}
