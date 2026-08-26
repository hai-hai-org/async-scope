import { useEffect, useMemo, useState } from "react";
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

  return {
    reload: () => setReloadToken((value) => value + 1),
    state,
  };
}
