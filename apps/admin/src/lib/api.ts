declare const __API_URL__: string

export const API_URL = __API_URL__

/**
 * Admin data access (ADMIN-001).
 *
 * Authenticated by an HttpOnly admin session cookie, issued only after a password AND a
 * TOTP code. Nothing secret is bundled into this app — the browser holds no key, and a
 * cookie it cannot read is scoped to the admin API path alone.
 */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

const ADMIN_BASE = `${API_URL}/api/v1/admin`

function failureMessage(status: number): string {
  // The API answers 404 for "no admin session" as well as "no such route", so the
  // console says the useful thing rather than repeating the status.
  if (status === 404) return 'Your session has ended. Sign in again.'
  if (status === 403) return 'Your role does not allow this.'
  if (status === 423) return 'This account is temporarily locked.'
  return `Request failed (${status})`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    // The session is an HttpOnly cookie; this app never sees or stores a credential.
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    let message = failureMessage(res.status)
    try {
      const body = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // Keep the status-derived message.
    }
    throw new AdminApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()).data as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export interface EmailEvent {
  id: string
  eventType: string
  occurredAt: string
}

export interface EmailMessage {
  id: string
  template: string
  recipientEmail: string
  subject: string
  provider: string
  providerMessageId: string | null
  status: string
  correlationId: string | null
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
  failedAt: string | null
  events: EmailEvent[]
}

export interface QueueCounts {
  name: string
  counts: Record<string, number>
}

export interface PlatformMetrics {
  users: number
  workspaces: number
  vehicles: number
  services: number
  activeReminders: number
  unreadNotifications: number
}

export interface AuditEntry {
  id: string
  action: string
  resourceType: string
  resourceId: string | null
  actorType: string
  actorUserId: string | null
  workspaceId: string | null
  createdAt: string
  metadata: unknown
}

export interface Suppression {
  id: string
  email: string
  reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL'
  detail: string | null
  createdAt: string
  releasedAt: string | null
  releasedBy: string | null
}

export interface AdminIdentity {
  id: string
  email: string
  role: 'SUPER_ADMIN' | 'OPERATIONS' | 'SUPPORT' | 'BILLING' | 'READ_ONLY'
}

export interface AdminSession {
  admin: AdminIdentity
  permissions: string[]
}

export interface SupportGrant {
  id: string
  adminUserId: string
  adminEmail: string
  adminRole: string
  workspaceId: string
  workspaceName: string
  reason: string
  scope: 'VEHICLE_CONTENT' | 'DOCUMENTS' | 'FULL'
  grantedAt: string
  expiresAt: string
  revokedAt: string | null
  useCount: number
  lastUsedAt: string | null
  /** Computed by the server so the console cannot disagree about what is live. */
  isActive: boolean
  minutesRemaining: number
}

export const adminApi = {
  auth: {
    login: (email: string, password: string, totpCode: string) =>
      post<AdminSession & { expiresAt: string }>('/auth/login', { email, password, totpCode }),
    session: () => get<AdminSession>('/auth/session'),
    logout: () => post<void>('/auth/logout'),
    confirmMfa: (code: string) => post<void>('/auth/mfa/confirm', { code }),
  },

  emails: (params: { status?: string; recipient?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    if (params.recipient) q.set('recipient', params.recipient)
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return get<EmailMessage[]>(`/emails${qs ? `?${qs}` : ''}`)
  },
  emailStats: () =>
    get<{ total: number; byStatus: Record<string, number>; failureRatePercent: number }>(
      '/emails/stats',
    ),
  queues: () => get<QueueCounts[]>('/queues'),
  metrics: () => get<PlatformMetrics>('/metrics'),
  audit: (limit = 50) => get<AuditEntry[]>(`/audit?limit=${limit}`),
  supportAccess: (includeExpired = false) =>
    get<SupportGrant[]>(`/support-access${includeExpired ? '?includeExpired=true' : ''}`),
  revokeSupportAccess: (id: string) =>
    request<SupportGrant>(`/support-access/${id}`, { method: 'DELETE' }),

  suppressions: (includeReleased = false) =>
    get<Suppression[]>(`/suppressions${includeReleased ? '?includeReleased=true' : ''}`),
  releaseSuppression: (email: string) =>
    post<{ released: boolean }>('/suppressions/release', { email }),
}
