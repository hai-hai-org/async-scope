import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSourceSnippet } from "../../shared/api/client";
import type {
  SourceReference,
  SourceSnippetPayload,
} from "../../shared/api/schemas";

export type SourceSnippetState =
  | { state: "idle"; data: null; error: null }
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: SourceSnippetPayload; error: null }
  | { state: "missing"; data: null; error: null }
  | { state: "error"; data: null; error: string };

export function useSourceSnippet(source: SourceReference | null, radius = 5) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<SourceSnippetState>({
    state: "idle",
    data: null,
    error: null,
  });
  const snippetRequest = useMemo(
    () => ({ radius, reloadToken, source }),
    [radius, reloadToken, source],
  );

  useEffect(() => {
    const currentSource = snippetRequest.source;

    if (!currentSource) {
      setState({ state: "missing", data: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ state: "loading", data: null, error: null });
    fetchSourceSnippet(currentSource, snippetRequest.radius)
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
              error instanceof Error ? error.message : "source unavailable",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [snippetRequest]);

  // identity를 고정한다. 렌더마다 새 함수면 이걸 의존성에 넣은 effect가 루프를 돈다.
  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  return {
    reload,
    state,
  };
}
