import { useEffect, useMemo, useState } from "react";
import {
  fetchFindingDetail,
  postFindingFeedback,
} from "../../shared/api/client";
import type {
  FindingFeedbackKind,
  FindingPayload,
} from "../../shared/api/schemas";

export type FindingDetailState =
  | { state: "idle"; data: null; error: null }
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: FindingPayload; error: null }
  | { state: "error"; data: null; error: string };

export function useFindingDetail(findingId: string | null) {
  const [reloadToken, setReloadToken] = useState(0);
  const [feedbackPending, setFeedbackPending] =
    useState<FindingFeedbackKind | null>(null);
  const [state, setState] = useState<FindingDetailState>({
    state: "idle",
    data: null,
    error: null,
  });
  const detailRequest = useMemo(
    () => ({ findingId, reloadToken }),
    [findingId, reloadToken],
  );

  useEffect(() => {
    const currentFindingId = detailRequest.findingId;
    if (!currentFindingId) {
      setState({ state: "idle", data: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ state: "loading", data: null, error: null });
    fetchFindingDetail(currentFindingId)
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
            error:
              error instanceof Error ? error.message : "finding detail failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailRequest]);

  const markFeedback = async (kind: FindingFeedbackKind) => {
    if (!findingId || feedbackPending) {
      return;
    }
    try {
      setFeedbackPending(kind);
      const payload = await postFindingFeedback(findingId, kind);
      setState({ state: "ready", data: payload, error: null });
    } finally {
      setFeedbackPending(null);
    }
  };

  return {
    feedbackPending,
    markFeedback,
    reload: () => setReloadToken((value) => value + 1),
    state,
  };
}
