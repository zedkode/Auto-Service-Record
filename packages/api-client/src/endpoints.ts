import type { ApiClient } from './client.js'
import type {
  Advisory,
  AppNotification,
  CostReport,
  CostSummaryRow,
  CurrentOdometer,
  DashboardData,
  DownloadLink,
  DueMaintenanceItem,
  FuelEconomy,
  Warranty,
  ExportDownload,
  ExportFormat,
  ExportJob,
  ExportKind,
  FleetReport,
  FuelTrend,
  FuelEntry,
  Expense,
  ExpenseCategory,
  ExpenseSummary,
  Inspection,
  InsurancePolicy,
  MaintenanceCompletion,
  MaintenanceRule,
  Invitation,
  InvitationPreview,
  MemberSummary,
  NotificationPreference,
  OdometerEntry,
  RoadTaxRecord,
  UploadSession,
  VaultDocument,
  Reminder,
  ReminderSummary,
  ServiceCategory,
  ServiceDetail,
  ServiceSummary,
  SessionResponse,
  TimelineEvent,
  VehicleDetail,
  VehicleSummary,
  WorkspaceDetail,
} from './types.js'

/** Endpoint surface, mirroring API.md §6. One place to change when a route changes. */
export function createApi(client: ApiClient) {
  return {
    auth: {
      session: () => client.get<SessionResponse>('/auth/session'),
      login: (email: string, password: string) =>
        client.post<{ user: { id: string; email: string } }>('/auth/login', { email, password }),
      register: (input: {
        email: string
        password: string
        passwordConfirmation: string
        displayName: string
        acceptTerms: true
      }) =>
        client.post<{
          user: { id: string; email: string }
          workspace: { id: string; name: string }
        }>('/auth/register', input),
      verifyEmail: (token: string) =>
        client.post<{ verified: boolean; alreadyVerified: boolean }>('/auth/verify-email', {
          token,
        }),
      resendVerification: () => client.post<{ sent: boolean }>('/auth/verify-email/resend'),
      forgotPassword: (email: string) =>
        client.post<{ message: string }>('/auth/forgot-password', { email }),
      resetPassword: (input: { token: string; password: string; passwordConfirmation: string }) =>
        client.post<{ reset: boolean }>('/auth/reset-password', input),
      devLogin: (email?: string) =>
        client.post<{ user: { id: string; email: string } }>('/auth/dev-login', { email }),
      logout: () => client.post<{ ok: boolean }>('/auth/logout'),
    },

    workspace: {
      get: (ws: string) => client.get<WorkspaceDetail>(`/workspaces/${ws}`),
      members: (ws: string) => client.get<MemberSummary[]>(`/workspaces/${ws}/members`),
      updateMemberRole: (ws: string, memberId: string, role: string) =>
        client.patch<MemberSummary>(`/workspaces/${ws}/members/${memberId}`, { role }),
      removeMember: (ws: string, memberId: string) =>
        client.delete<void>(`/workspaces/${ws}/members/${memberId}`),
      leave: (ws: string) => client.post<void>(`/workspaces/${ws}/members/leave`),
      transferOwnership: (ws: string, memberId: string) =>
        client.post<MemberSummary[]>(`/workspaces/${ws}/members/transfer-ownership`, {
          memberId,
          confirm: 'TRANSFER',
        }),

      invitations: (ws: string) => client.get<Invitation[]>(`/workspaces/${ws}/invitations`),
      invite: (ws: string, email: string, role: string) =>
        client.post<Invitation>(`/workspaces/${ws}/invitations`, { email, role }),
      revokeInvitation: (ws: string, id: string) =>
        client.delete<Invitation>(`/workspaces/${ws}/invitations/${id}`),
      dashboard: (ws: string) => client.get<DashboardData>(`/workspaces/${ws}/dashboard`),
    },

    vehicles: {
      list: (ws: string, includeInactive = false) =>
        client.get<VehicleSummary[]>(
          `/workspaces/${ws}/vehicles${includeInactive ? '?includeInactive=true' : ''}`,
        ),
      listDeleted: (ws: string) =>
        client.get<Array<VehicleSummary & { deletedAt: string | null }>>(
          `/workspaces/${ws}/vehicles/deleted`,
        ),
      changeStatus: (ws: string, vehicleId: string, status: string, reason?: string) =>
        client.patch<VehicleDetail>(`/workspaces/${ws}/vehicles/${vehicleId}/status`, {
          status,
          ...(reason ? { reason } : {}),
        }),
      remove: (ws: string, vehicleId: string) =>
        client.delete<void>(`/workspaces/${ws}/vehicles/${vehicleId}`),
      restore: (ws: string, vehicleId: string) =>
        client.post<VehicleDetail>(`/workspaces/${ws}/vehicles/${vehicleId}/restore`),
      get: (ws: string, id: string) =>
        client.get<VehicleDetail>(`/workspaces/${ws}/vehicles/${id}`),
      create: (ws: string, input: Record<string, unknown>) =>
        client.post<VehicleDetail>(`/workspaces/${ws}/vehicles`, input),
      timeline: (ws: string, id: string) =>
        client.get<TimelineEvent[]>(`/workspaces/${ws}/vehicles/${id}/timeline`),
      odometer: (ws: string, id: string) =>
        client.get<OdometerEntry[]>(`/workspaces/${ws}/vehicles/${id}/odometer`),
      currentOdometer: (ws: string, id: string) =>
        client.get<CurrentOdometer>(`/workspaces/${ws}/vehicles/${id}/odometer/current`),
      addOdometer: (ws: string, id: string, input: Record<string, unknown>) =>
        client.post<OdometerEntry>(`/workspaces/${ws}/vehicles/${id}/odometer`, input),
    },

    services: {
      categories: (ws: string) =>
        client.get<ServiceCategory[]>(`/workspaces/${ws}/service-categories`),
      list: (ws: string, params: Record<string, string | undefined> = {}) => {
        const q = new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [
            string,
            string,
          ][],
        ).toString()
        return client.get<ServiceSummary[]>(`/workspaces/${ws}/services${q ? `?${q}` : ''}`)
      },
      listForVehicle: (
        ws: string,
        vehicleId: string,
        params: Record<string, string | undefined> = {},
      ) => {
        const q = new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [
            string,
            string,
          ][],
        ).toString()
        return client.get<ServiceSummary[]>(
          `/workspaces/${ws}/vehicles/${vehicleId}/services${q ? `?${q}` : ''}`,
        )
      },
      get: (ws: string, serviceId: string) =>
        client.get<ServiceDetail>(`/workspaces/${ws}/services/${serviceId}`),
      create: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<ServiceDetail>(`/workspaces/${ws}/vehicles/${vehicleId}/services`, input),
      update: (ws: string, serviceId: string, input: Record<string, unknown>) =>
        client.patch<ServiceDetail>(`/workspaces/${ws}/services/${serviceId}`, input),
      remove: (ws: string, serviceId: string) =>
        client.delete<void>(`/workspaces/${ws}/services/${serviceId}`),
      costSummary: (ws: string, vehicleId: string) =>
        client.get<CostSummaryRow[]>(
          `/workspaces/${ws}/vehicles/${vehicleId}/services/cost-summary`,
        ),
    },

    reminders: {
      list: (ws: string, filter?: 'active' | 'all') =>
        client.get<Reminder[]>(`/workspaces/${ws}/reminders${filter ? `?filter=${filter}` : ''}`),
      summary: (ws: string) => client.get<ReminderSummary>(`/workspaces/${ws}/reminders/summary`),
      snooze: (ws: string, id: string, input: { days?: number; until?: string }) =>
        client.post<Reminder>(`/workspaces/${ws}/reminders/${id}/snooze`, input),
      dismiss: (ws: string, id: string) =>
        client.post<void>(`/workspaces/${ws}/reminders/${id}/dismiss`),
      complete: (ws: string, id: string) =>
        client.post<void>(`/workspaces/${ws}/reminders/${id}/complete`),
    },

    notifications: {
      list: (opts: { unread?: boolean; limit?: number } = {}) => {
        const q = new URLSearchParams()
        if (opts.unread) q.set('unread', 'true')
        if (opts.limit) q.set('limit', String(opts.limit))
        const qs = q.toString()
        return client.get<AppNotification[]>(`/notifications${qs ? `?${qs}` : ''}`)
      },
      unreadCount: () => client.get<{ count: number }>('/notifications/unread-count'),
      markRead: (id: string) => client.post<{ ok: boolean }>(`/notifications/${id}/read`),
      markAllRead: () => client.post<{ marked: number }>('/notifications/read-all'),
      preferences: (ws: string) =>
        client.get<NotificationPreference[]>(`/workspaces/${ws}/notification-preferences`),
      setPreference: (
        ws: string,
        input: { category: string; channel: string; isEnabled: boolean },
      ) =>
        client.put<NotificationPreference[]>(`/workspaces/${ws}/notification-preferences`, input),
    },

    maintenance: {
      due: (ws: string) => client.get<DueMaintenanceItem[]>(`/workspaces/${ws}/maintenance/due`),
      listForVehicle: (ws: string, vehicleId: string) =>
        client.get<MaintenanceRule[]>(`/workspaces/${ws}/vehicles/${vehicleId}/maintenance`),
      create: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<MaintenanceRule>(`/workspaces/${ws}/vehicles/${vehicleId}/maintenance`, input),
      applyTemplate: (ws: string, vehicleId: string) =>
        client.post<{ created: number }>(
          `/workspaces/${ws}/vehicles/${vehicleId}/maintenance/apply-template`,
        ),
      update: (ws: string, ruleId: string, input: Record<string, unknown>) =>
        client.patch<MaintenanceRule>(`/workspaces/${ws}/maintenance/${ruleId}`, input),
      remove: (ws: string, ruleId: string) =>
        client.delete<void>(`/workspaces/${ws}/maintenance/${ruleId}`),
      complete: (ws: string, ruleId: string, input: Record<string, unknown>) =>
        client.post<MaintenanceRule>(`/workspaces/${ws}/maintenance/${ruleId}/complete`, input),
      completions: (ws: string, ruleId: string) =>
        client.get<MaintenanceCompletion[]>(`/workspaces/${ws}/maintenance/${ruleId}/completions`),
    },
    ownership: {
      inspections: (ws: string, vehicleId?: string) =>
        client.get<Inspection[]>(
          `/workspaces/${ws}/inspections${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
        ),
      createInspection: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<Inspection>(`/workspaces/${ws}/vehicles/${vehicleId}/inspections`, input),
      removeInspection: (ws: string, id: string) =>
        client.delete<void>(`/workspaces/${ws}/inspections/${id}`),
      resolveAdvisory: (ws: string, advisoryId: string, isResolved: boolean) =>
        client.patch<Advisory>(`/workspaces/${ws}/advisories/${advisoryId}`, { isResolved }),

      insurance: (ws: string, vehicleId?: string) =>
        client.get<InsurancePolicy[]>(
          `/workspaces/${ws}/insurance-policies${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
        ),
      createInsurance: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<InsurancePolicy>(
          `/workspaces/${ws}/vehicles/${vehicleId}/insurance-policies`,
          input,
        ),
      removeInsurance: (ws: string, id: string) =>
        client.delete<void>(`/workspaces/${ws}/insurance-policies/${id}`),

      roadTax: (ws: string, vehicleId?: string) =>
        client.get<RoadTaxRecord[]>(
          `/workspaces/${ws}/road-tax${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
        ),
      createRoadTax: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<RoadTaxRecord>(`/workspaces/${ws}/vehicles/${vehicleId}/road-tax`, input),
      removeRoadTax: (ws: string, id: string) =>
        client.delete<void>(`/workspaces/${ws}/road-tax/${id}`),
    },

    expenses: {
      categories: (ws: string) =>
        client.get<ExpenseCategory[]>(`/workspaces/${ws}/expense-categories`),
      list: (
        ws: string,
        params: { vehicleId?: string; dateFrom?: string; dateTo?: string } = {},
      ) => {
        const q = new URLSearchParams()
        if (params.vehicleId) q.set('vehicleId', params.vehicleId)
        if (params.dateFrom) q.set('dateFrom', params.dateFrom)
        if (params.dateTo) q.set('dateTo', params.dateTo)
        const qs = q.toString()
        return client.get<Expense[]>(`/workspaces/${ws}/expenses${qs ? `?${qs}` : ''}`)
      },
      summary: (ws: string, from?: string, to?: string) => {
        const q = new URLSearchParams()
        if (from) q.set('from', from)
        if (to) q.set('to', to)
        const qs = q.toString()
        return client.get<ExpenseSummary>(`/workspaces/${ws}/expenses/summary${qs ? `?${qs}` : ''}`)
      },
      create: (ws: string, input: Record<string, unknown>) =>
        client.post<Expense>(`/workspaces/${ws}/expenses`, input),
      update: (ws: string, id: string, input: Record<string, unknown>) =>
        client.patch<Expense>(`/workspaces/${ws}/expenses/${id}`, input),
      remove: (ws: string, id: string) => client.delete<void>(`/workspaces/${ws}/expenses/${id}`),
    },

    invitations: {
      preview: (token: string) =>
        client.get<InvitationPreview>(`/invitations/preview?token=${encodeURIComponent(token)}`),
      accept: (token: string) =>
        client.post<{ workspaceId: string; alreadyMember: boolean }>('/invitations/accept', {
          token,
        }),
    },

    reports: {
      costs: (ws: string, params: { from?: string; to?: string; vehicleId?: string } = {}) => {
        const q = new URLSearchParams()
        if (params.from) q.set('from', params.from)
        if (params.to) q.set('to', params.to)
        if (params.vehicleId) q.set('vehicleId', params.vehicleId)
        const qs = q.toString()
        return client.get<CostReport>(`/workspaces/${ws}/reports/costs${qs ? `?${qs}` : ''}`)
      },
      fleet: (ws: string, params: { from?: string; to?: string } = {}) => {
        const q = new URLSearchParams()
        if (params.from) q.set('from', params.from)
        if (params.to) q.set('to', params.to)
        const qs = q.toString()
        return client.get<FleetReport>(`/workspaces/${ws}/reports/fleet${qs ? `?${qs}` : ''}`)
      },
    },

    fuel: {
      list: (ws: string, vehicleId: string) =>
        client.get<FuelEntry[]>(`/workspaces/${ws}/vehicles/${vehicleId}/fuel`),
      economy: (ws: string, vehicleId: string) =>
        client.get<FuelEconomy>(`/workspaces/${ws}/vehicles/${vehicleId}/fuel/economy`),
      trend: (ws: string, vehicleId: string) =>
        client.get<FuelTrend>(`/workspaces/${ws}/vehicles/${vehicleId}/fuel/trend`),
      create: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<FuelEntry>(`/workspaces/${ws}/vehicles/${vehicleId}/fuel`, input),
      update: (ws: string, id: string, input: Record<string, unknown>) =>
        client.patch<FuelEntry>(`/workspaces/${ws}/fuel/${id}`, input),
      remove: (ws: string, id: string) => client.delete<void>(`/workspaces/${ws}/fuel/${id}`),
    },

    warranties: {
      list: (ws: string, vehicleId?: string) =>
        client.get<Warranty[]>(
          `/workspaces/${ws}/warranties${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
        ),
      create: (ws: string, vehicleId: string, input: Record<string, unknown>) =>
        client.post<Warranty>(`/workspaces/${ws}/vehicles/${vehicleId}/warranties`, input),
      update: (ws: string, id: string, input: Record<string, unknown>) =>
        client.patch<Warranty>(`/workspaces/${ws}/warranties/${id}`, input),
      remove: (ws: string, id: string) => client.delete<void>(`/workspaces/${ws}/warranties/${id}`),
    },

    exports: {
      list: (ws: string) => client.get<ExportJob[]>(`/workspaces/${ws}/exports`),
      get: (ws: string, id: string) => client.get<ExportJob>(`/workspaces/${ws}/exports/${id}`),
      create: (
        ws: string,
        input: {
          kind: ExportKind
          format: ExportFormat
          from?: string
          to?: string
          vehicleId?: string
        },
      ) => client.post<ExportJob>(`/workspaces/${ws}/exports`, input),
      // POST, not GET: it mints a signed URL and writes an audit entry, so it must not be
      // prefetched or replayed from browser history.
      download: (ws: string, id: string) =>
        client.post<ExportDownload>(`/workspaces/${ws}/exports/${id}/download`, {}),
    },

    documents: {
      list: (ws: string, vehicleId?: string) =>
        client.get<VaultDocument[]>(
          `/workspaces/${ws}/documents${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
        ),
      createUploadSession: (ws: string, input: Record<string, unknown>) =>
        client.post<UploadSession>(`/workspaces/${ws}/documents/upload-session`, input),
      finalise: (ws: string, id: string) =>
        client.post<VaultDocument>(`/workspaces/${ws}/documents/${id}/finalise`),
      downloadUrl: (ws: string, id: string) =>
        client.get<DownloadLink>(`/workspaces/${ws}/documents/${id}/download`),
      update: (ws: string, id: string, input: Record<string, unknown>) =>
        client.patch<VaultDocument>(`/workspaces/${ws}/documents/${id}`, input),
      remove: (ws: string, id: string) => client.delete<void>(`/workspaces/${ws}/documents/${id}`),
    },
  }
}

export type Api = ReturnType<typeof createApi>
