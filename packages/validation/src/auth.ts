import { z } from 'zod'
import { email, password, shortText } from './primitives.js'

export const registerSchema = z
  .object({
    email,
    password,
    passwordConfirmation: z.string(),
    displayName: shortText.min(1, 'Tell us what to call you.'),
    // Consent is explicit and separate from marketing consent (SECURITY.md §12).
    acceptTerms: z.literal(true, { message: 'You need to accept the terms to continue.' }),
  })
  .refine((v) => v.password === v.passwordConfirmation, {
    message: 'Both passwords must match.',
    path: ['passwordConfirmation'],
  })
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})
export type LoginInput = z.infer<typeof loginSchema>

export const verifyEmailSchema = z.object({
  token: z.string().min(10).max(500),
})
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>

export const forgotPasswordSchema = z.object({ email })
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10).max(500),
    password,
    passwordConfirmation: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirmation, {
    message: 'Both passwords must match.',
    path: ['passwordConfirmation'],
  })
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
