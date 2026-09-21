import type { MaintenanceStatus } from '@autoservices/api-client'
import type { TrackingStatus } from '@autoservices/ui'

/**
 * Maps the server's maintenance status onto the shared visual vocabulary
 * (UI_UX.md §6). The server decides the status; this only decides how it looks.
 */
export const MAINTENANCE_TONE: Record<MaintenanceStatus, TrackingStatus> = {
  OK: 'HEALTHY',
  DUE_SOON: 'DUE_SOON',
  DUE: 'ATTENTION',
  OVERDUE: 'OVERDUE',
}
