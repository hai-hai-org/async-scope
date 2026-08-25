import type { ExportPayload, SummaryPayload } from "./schemas";

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
