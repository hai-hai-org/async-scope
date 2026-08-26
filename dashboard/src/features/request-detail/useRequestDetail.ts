import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRequestDetail } from "../../shared/api/client";
import {
  buildFallbackRequestDetail,
  mergeTimelineEvents,
} from "../../shared/api/eventStore";
import type {
  NormalizedEvent,
  RequestDetailPayload,
} from "../../shared/api/schemas";

export type RequestDetailState =
  | { state: "idle"; data: null; error: null }
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: RequestDetailPayload; error: null }
  | { state: "fallback"; data: RequestDetailPayload; error: string | null }
  | { state: "error"; data: null; error: string };

type UseRequestDetailOptions = {
  fallbackEvents?: NormalizedEvent[];
  fetchEnabled?: boolean;
  requestId: string | null;
};

export function useRequestDetail({
  fallbackEvents,
  fetchEnabled = true,
  requestId,
}: UseRequestDetailOptions) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<RequestDetailState>({
    state: "idle",
    data: null,
    error: null,
  });
  const fallbackDetail = useMemo(() => {
    if (!requestId || !fallbackEvents) {
      return null;
    }
    return buildFallbackRequestDetail(
      mergeTimelineEvents([], fallbackEvents),
      requestId,
    );
  }, [fallbackEvents, requestId]);
  const detailRequest = useMemo(
    () => ({ reloadToken, requestId }),
    [reloadToken, requestId],
  );

  useEffect(() => {
    const currentRequestId = detailRequest.requestId;

    if (!currentRequestId) {
      setState({ state: "idle", data: null, error: null });
      return;
    }
    if (!fetchEnabled) {
      setState(
        fallbackDetail
          ? { state: "fallback", data: fallbackDetail, error: null }
          : { state: "error", data: null, error: "request detail unavailable" },
      );
      return;
    }

    let cancelled = false;
    setState({ state: "loading", data: null, error: null });
    fetchRequestDetail(currentRequestId)
      .then((detail) => {
        if (!cancelled) {
          setState({ state: "ready", data: detail, error: null });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "request detail failed";
        setState(
          fallbackDetail
            ? { state: "fallback", data: fallbackDetail, error: message }
            : { state: "error", data: null, error: message },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [detailRequest, fallbackDetail, fetchEnabled]);

  // identity를 고정한다. 렌더마다 새 함수면 이걸 의존성에 넣은 effect가 루프를 돈다.
  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  return {
    reload,
    state,
  };
}
