import type {
  ExportPayload,
  FindingFeedbackKind,
  FindingPayload,
  FindingsListPayload,
  FindingsQuery,
  RequestDetailPayload,
  RequestsListPayload,
  RequestsQuery,
  SettingsPatch,
  SettingsPayload,
  SourceReference,
  SourceSnippetPayload,
  SummaryPayload,
} from "./schemas";

const API_PREFIX = "/__asyncscope__/api";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchSummary(windowS = 60): Promise<SummaryPayload> {
  return fetchJson<SummaryPayload>(`${API_PREFIX}/summary?window=${windowS}`);
}

export async function fetchExport(): Promise<ExportPayload> {
  return fetchJson<ExportPayload>(`${API_PREFIX}/export`);
}

/** export JSON을 파일로 저장한다. 화면에 보이는 buffer와 같은 내용이다. */
export async function downloadExport(): Promise<void> {
  const payload = await fetchExport();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "asyncscope-export.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 버퍼를 비우고 지금부터 새로 추적한다. 응답은 export와 같은 모양이다(비운 직후라 events는 항상 빈 배열). */
export async function clearBuffer(): Promise<ExportPayload> {
  return fetchJson<ExportPayload>(`${API_PREFIX}/buffer/clear`, {
    method: "POST",
  });
}

export async function fetchSettings(): Promise<SettingsPayload> {
  return fetchJson<SettingsPayload>(`${API_PREFIX}/settings`);
}

export async function patchSettings(
  patch: SettingsPatch,
): Promise<SettingsPayload> {
  return fetchJson<SettingsPayload>(`${API_PREFIX}/settings`, {
    body: JSON.stringify(patch),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "PATCH",
  });
}

export async function fetchFindings(
  query: FindingsQuery,
): Promise<FindingsListPayload> {
  return fetchJson<FindingsListPayload>(
    `${API_PREFIX}/findings?${findingQueryString(query)}`,
  );
}

export async function fetchFindingDetail(
  findingId: string,
): Promise<FindingPayload> {
  return fetchJson<FindingPayload>(
    `${API_PREFIX}/findings/${encodeURIComponent(findingId)}`,
  );
}

export async function postFindingFeedback(
  findingId: string,
  kind: FindingFeedbackKind,
): Promise<FindingPayload> {
  return fetchJson<FindingPayload>(
    `${API_PREFIX}/findings/${encodeURIComponent(findingId)}/feedback`,
    {
      body: JSON.stringify({ kind }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}

export async function fetchRequests(
  query: RequestsQuery,
): Promise<RequestsListPayload> {
  return fetchJson<RequestsListPayload>(
    `${API_PREFIX}/requests?${requestQueryString(query)}`,
  );
}

export async function fetchRequestDetail(
  requestId: string,
): Promise<RequestDetailPayload> {
  return fetchJson<RequestDetailPayload>(
    `${API_PREFIX}/requests/${encodeURIComponent(requestId)}`,
  );
}

export async function fetchSourceSnippet(
  source: SourceReference,
  radius = 5,
): Promise<SourceSnippetPayload> {
  const params = new URLSearchParams({
    file: source.file,
    line: String(source.line),
    radius: String(radius),
  });
  return fetchJson<SourceSnippetPayload>(`${API_PREFIX}/source?${params}`);
}

function findingQueryString(query: FindingsQuery) {
  const params = new URLSearchParams({
    page: String(query.page),
    page_size: String(query.page_size),
  });
  if (query.type) {
    params.set("type", query.type);
  }
  if (query.severity) {
    params.set("severity", query.severity);
  }
  if (query.evidence) {
    params.set("evidence", query.evidence);
  }
  if (query.request_id) {
    params.set("request_id", query.request_id);
  }
  return params.toString();
}

function requestQueryString(query: RequestsQuery) {
  const params = new URLSearchParams({
    sort: query.sort,
    order: query.order,
    page: String(query.page),
    page_size: String(query.page_size),
  });
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.method) {
    params.set("method", query.method);
  }
  if (query.path) {
    params.set("path", query.path);
  }
  return params.toString();
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    ...init,
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  if (!contentType.includes("application/json")) {
    throw new ApiError(response.status, `expected JSON response from ${path}`);
  }
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
    };
    return payload.message ?? payload.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
