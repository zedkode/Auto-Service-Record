import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionResponse, WorkspaceSummary } from '@autoservices/api-client'
import { api } from './api.js'

export interface SessionValue {
  session: SessionResponse
  workspace: WorkspaceSummary
  setWorkspace: (id: string) => void
  signOut: () => Promise<void>
}

export const SessionContext = createContext<SessionValue | null>(null)
export const WORKSPACE_STORAGE_KEY = 'autoservices.workspaceId'

/** Bootstrap query for the authenticated session. A 401 is the unauthenticated path. */
export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.auth.session(),
    retry: false,
  })
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
