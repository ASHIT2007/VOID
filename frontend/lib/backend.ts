const DEFAULT_BACKEND_URL = "http://127.0.0.1:3001";

export function getBackendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.FREELLM_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    DEFAULT_BACKEND_URL
  ).replace(/\/$/, "");
}

export function backendUrl(path: string): string {
  return `${getBackendUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
