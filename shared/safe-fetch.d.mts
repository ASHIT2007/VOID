export function isPublicAddress(address: string): boolean;
export function safePublicFetch(value: string | URL, options?: { maxBytes?: number; signal?: AbortSignal }): Promise<Response>;
