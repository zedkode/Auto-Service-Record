import { AsyncLocalStorage } from 'node:async_hooks'
import type { WorkspaceRole } from '@autoservices/types'

export interface RequestContext {
  correlationId: string
  userId?: string
  workspaceId?: string
  role?: WorkspaceRole
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore()
}
