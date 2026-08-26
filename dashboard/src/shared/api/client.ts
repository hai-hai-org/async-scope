import type {
  ExportPayload,
  RequestDetailPayload,
  RequestsListPayload,
  RequestsQuery,
  SourceLocation,
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
  source: SourceLocation,
  radius = 5,
): Promise<SourceSnippetPayload> {
  const params = new URLSearchParams({
    file: source.file,
    line: String(source.line),
    radius: String(radius),
  });
  return fetchJson<SourceSnippetPayload>(`${API_PREFIX}/source?${params}`);
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
