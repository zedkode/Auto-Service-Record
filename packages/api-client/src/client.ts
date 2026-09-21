import type { ApiEnvelope, ApiErrorBody } from './types.js'

/**
 * Typed API client. UI components never call fetch() directly (task brief §23) — every
 * request goes through here so credentials, correlation IDs and error shaping are
 * handled in exactly one place.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Field-level messages, for rendering next to form inputs. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {}
    const out: Record<string, string> = {}
    for (const d of this.details as Array<{ field?: string; message?: string }>) {
      if (d.field && d.message) out[d.field] = d.message
    }
    return out
  }
}

export interface ApiClientOptions {
  baseUrl: string
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.options.baseUrl}/api/v1${path}`, {
        method,
        // Session lives in an HttpOnly cookie; it must be sent cross-origin.
        credentials: 'include',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    } catch (cause) {
      throw new ApiError(
        'NETWORK_ERROR',
        'Could not reach the server. Check your connection and try again.',
        0,
        'n/a',
        cause,
      )
    }

    if (res.status === 204) return undefined as T

    const text = await res.text()
    const parsed: unknown = text ? JSON.parse(text) : {}

    if (!res.ok) {
      const err = (parsed as ApiErrorBody).error
      throw new ApiError(
        err?.code ?? 'INTERNAL_ERROR',
        err?.message ?? 'Something went wrong.',
        res.status,
        err?.requestId ?? res.headers.get('x-request-id') ?? 'unknown',
        err?.details,
      )
    }

    return (parsed as ApiEnvelope<T>).data
  }

  get<T>(path: string, signal?: AbortSignal) {
    return this.request<T>('GET', path, undefined, signal)
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body)
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body)
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body)
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path)
  }
}
