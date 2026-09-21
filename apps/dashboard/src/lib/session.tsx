import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SessionResponse } from '@autoservices/api-client'
import { api } from './api.js'
import { SessionContext, WORKSPACE_STORAGE_KEY } from './use-session.js'

export function SessionProvider({
  session,
  children,
}: {
  session: SessionResponse
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Remembering the active workspace is a per-viewer convenience, so localStorage is
  // right — but it can throw in private mode, so every access is guarded.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WORKSPACE_STORAGE_KEY)
    } catch {
      return null
    }
  })
  const workspace = session.workspaces.find((w) => w.id === selectedId) ?? session.workspaces[0]

  if (!workspace) {
    throw new Error('No workspace available for this account')
  }

  const setWorkspace = (id: string) => {
    if (!session.workspaces.some((w) => w.id === id)) return
    setSelectedId(id)
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, id)
    } catch {
      /* non-fatal */
    }
    void queryClient.invalidateQueries()
    navigate('/')
  }

  const signOut = async () => {
    try {
      await api.auth.logout()
    } catch {
      // The session may already be gone server-side; sign out locally regardless.
    }
    try {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    } catch {
      /* non-fatal */
    }
    queryClient.clear()
    // A hard navigation rather than a client-side one. Sign-out is a security boundary:
    // reloading guarantees no component keeps authenticated state in memory.
    window.location.assign('/sign-in')
  }

  return (
    <SessionContext.Provider value={{ session, workspace, setWorkspace, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}
