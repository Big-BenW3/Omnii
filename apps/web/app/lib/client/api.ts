/** Typed fetch wrapper for /api/v1. Cookies carry the session; nothing else identifies the caller. */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiFailure(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}
