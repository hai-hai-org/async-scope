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

/**
 * externalReloadToken: 이 페이지 밖(헤더의 버퍼 비우기 등)에서 데이터가
 * 통째로 바뀌었다는 신호다. 내부 reloadToken(이 페이지의 새로 고침 버튼)과
 * 합쳐서 둘 중 하나만 바뀌어도 다시 읽는다.
 */
export function useFindings(query: FindingsQuery, externalReloadToken = 0) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<FindingsState>({
    state: "loading",
    data: null,
    error: null,
  });
  const findingsRequest = useMemo(
    () => ({ query, reloadToken, externalReloadToken }),
    [query, reloadToken, externalReloadToken],
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
