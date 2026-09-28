export function getBackendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    `http://127.0.0.1:${process.env.BACKEND_PORT || "3001"}`
  ).replace(/\/$/, "");
}

export function backendHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (process.env.VOID_INTERNAL_KEY) result.set('x-void-internal-key', process.env.VOID_INTERNAL_KEY);
  return result;
}

export function backendUrl(path: string): string {
  return `${getBackendUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
