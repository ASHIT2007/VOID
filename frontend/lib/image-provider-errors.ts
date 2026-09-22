export type ImageFailure = { provider: string; kind: 'configuration' | 'quota' | 'authentication' | 'unavailable' | 'review'; message: string };

/** A sanitized, user-facing error returned by our image endpoint. */
export class ImageGenerationError extends Error {}

export function imageProviderFailure(provider: string, error: unknown): ImageFailure {
  const message = error instanceof Error ? error.message : String(error);
  const kind = /not configured/i.test(message) ? 'configuration'
    : /\b(?:402|429)\b|quota|balance|billing|rate.limit/i.test(message) ? 'quota'
    : /\b(?:401|403)\b|unauthori[sz]ed|invalid.api.key/i.test(message) ? 'authentication'
    : 'unavailable';
  return { provider, kind, message };
}

/** Never turn transport, credentials or quota failures into prompt rejections. */
export function imageFailureResponse(failures: ImageFailure[]) {
  const operational = failures.filter((failure) => failure.kind !== 'review');
  if (failures.length > 0 && operational.length === 0) {
    return { status: 422, code: 'IMAGE_REVIEW_REJECTED', retryable: false,
      error: 'The generated images did not pass the content or relevance review. Please adjust the image description and try again.' };
  }
  if (failures.length === 0 || failures.every((failure) => failure.kind === 'configuration')) {
    return { status: 503, code: 'IMAGE_NOT_CONFIGURED', retryable: false,
      error: 'No image provider is configured. Add an image provider credential before generating images.' };
  }
  if (operational.some((failure) => failure.kind === 'quota')) {
    return { status: 429, code: 'IMAGE_QUOTA_EXCEEDED', retryable: true,
      error: 'Image providers have reached a quota or billing limit. Use Auto Image to try other providers, or restore the provider quota and retry.' };
  }
  if (operational.some((failure) => failure.kind === 'authentication')) {
    return { status: 503, code: 'IMAGE_AUTHENTICATION_FAILED', retryable: false,
      error: 'Image provider credentials were rejected. Update the provider credentials or choose Auto Image.' };
  }
  return { status: 503, code: 'IMAGE_PROVIDERS_UNAVAILABLE', retryable: true,
    error: 'The image providers are temporarily unavailable or timed out. Your prompt was kept; please retry.' };
}
