import { z } from 'zod'
import { email as emailSchema, shortText } from './primitives.js'

/** OWNER is deliberately absent: you become OWNER only through a transfer. */
export const assignableRole = z.enum(['ADMIN', 'EDITOR', 'DRIVER', 'VIEWER'])

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: assignableRole.default('VIEWER'),
  message: shortText.optional(),
})
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

export const updateMemberRoleSchema = z.object({
  role: assignableRole,
})
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>

/**
 * Transferring ownership is typed out in full rather than confirmed with a checkbox:
 * it is irreversible without the other person's cooperation, and the person doing it
 * loses their own OWNER role in the same breath.
 */
export const transferOwnershipSchema = z.object({
  memberId: z.uuid(),
  confirm: z.literal('TRANSFER', {
    message: 'Type TRANSFER to confirm you are handing over ownership.',
  }),
})
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>

export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(500),
})
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
