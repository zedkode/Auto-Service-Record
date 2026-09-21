import { z } from 'zod'
import { shortText, currencyCode, distanceUnit } from './primitives.js'

export const workspaceType = z.enum(['PERSONAL', 'FAMILY', 'BUSINESS', 'FLEET', 'CLUB', 'OTHER'])
export const workspaceRole = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'DRIVER', 'VIEWER'])

export const createWorkspaceSchema = z.object({
  name: shortText.min(1, 'Give the workspace a name.'),
  type: workspaceType.default('PERSONAL'),
  defaultCurrency: currencyCode.default('GBP'),
  defaultDistanceUnit: distanceUnit.default('MILES'),
  timezone: z.string().max(64).default('Europe/London'),
})
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>

export const updateWorkspaceSchema = createWorkspaceSchema.partial()
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
