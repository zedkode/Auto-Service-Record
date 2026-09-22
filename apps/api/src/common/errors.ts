/**
 * Domain errors. Services throw these; the exception filter maps them to the standard
 * HTTP envelope (API.md §5). Controllers never build error responses themselves.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'SESSION_EXPIRED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'WORKSPACE_NOT_FOUND'
  | 'NOT_A_MEMBER'
  | 'PERMISSION_DENIED'
  | 'OWNER_REQUIRED'
  | 'VEHICLE_NOT_FOUND'
  | 'DUPLICATE_REGISTRATION'
  | 'REGISTRATION_REUSED'
  | 'VEHICLE_ARCHIVED'
  | 'ODOMETER_REGRESSION'
  | 'ODOMETER_FUTURE_DATE'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const Errors = {
  unauthenticated: () => new DomainError('UNAUTHENTICATED', 'You need to sign in.', 401),
  invalidCredentials: () =>
    // Deliberately identical for unknown email and wrong password (SECURITY.md §4).
    new DomainError('INVALID_CREDENTIALS', 'That email or password is not correct.', 401),
  accountLocked: () =>
    new DomainError('ACCOUNT_LOCKED', 'Too many attempts. Try again shortly.', 423),
  accountSuspended: () =>
    new DomainError('ACCOUNT_SUSPENDED', 'This account has been suspended.', 403),
  emailAlreadyRegistered: () =>
    new DomainError('EMAIL_ALREADY_REGISTERED', 'That email is already registered.', 409),

  /**
   * 404, never 403, when the caller is not a member: a 403 confirms the resource exists
   * in another tenant (DECISIONS.md D-012, SECURITY.md §3).
   */
  workspaceNotFound: () =>
    new DomainError('WORKSPACE_NOT_FOUND', 'Workspace could not be found.', 404),
  permissionDenied: (what = 'do that') =>
    new DomainError('PERMISSION_DENIED', `You do not have permission to ${what}.`, 403),

  vehicleNotFound: () => new DomainError('VEHICLE_NOT_FOUND', 'Vehicle could not be found.', 404),
  duplicateRegistration: (reg: string) =>
    new DomainError(
      'DUPLICATE_REGISTRATION',
      `A vehicle with registration ${reg} already exists in this workspace.`,
      409,
    ),
  /**
   * Restoring a soft-deleted vehicle whose plate has since been given to another vehicle.
   * Distinct from DUPLICATE_REGISTRATION because the user did not type a registration
   * here — they pressed Restore — so "already exists" would read as a non-sequitur.
   */
  registrationReused: (reg: string) =>
    new DomainError(
      'REGISTRATION_REUSED',
      `Registration ${reg} now belongs to another vehicle in this workspace. ` +
        'Change that vehicle’s registration first, then restore this one.',
      409,
    ),
  odometerRegression: (latest: number, unit: string) =>
    new DomainError(
      'ODOMETER_REGRESSION',
      `That reading is lower than the last recorded ${latest.toLocaleString()} ${unit === 'MILES' ? 'mi' : 'km'}. Check the number, or record it as a correction.`,
      409,
      { latestValue: latest, unit },
    ),
  serviceFutureDate: () =>
    new DomainError('VALIDATION_FAILED', 'A service cannot be dated in the future.', 422),
  odometerFutureDate: () =>
    new DomainError('ODOMETER_FUTURE_DATE', 'A mileage reading cannot be in the future.', 422),

  tokenInvalid: () =>
    // One message for missing, expired, consumed and forged tokens: distinguishing them
    // tells an attacker which guesses were close.
    new DomainError(
      'TOKEN_INVALID',
      'That link is invalid or has expired. Request a new one.',
      400,
    ),
  emailNotVerified: () =>
    new DomainError('EMAIL_NOT_VERIFIED', 'Please confirm your email address first.', 403),

  notFound: (what = 'Resource') => new DomainError('NOT_FOUND', `${what} could not be found.`, 404),
  notImplemented: (what: string) =>
    new DomainError('NOT_IMPLEMENTED', `${what} is not available yet.`, 501),

  /**
   * A document that is not AVAILABLE is never served — whether it is still uploading or
   * was quarantined for not matching what was declared.
   */
  documentNotAvailable: () => new DomainError('NOT_FOUND', 'That document is not available.', 404),

  /**
   * A projected expense mirrors another record. Editing it here would be silently undone
   * the next time that record changed, so the message points at the real edit instead of
   * refusing without explanation.
   */
  projectedExpenseReadOnly: (sourceType: string) => {
    const source =
      sourceType === 'SERVICE'
        ? 'service record'
        : sourceType === 'INSURANCE'
          ? 'insurance policy'
          : sourceType === 'TAX'
            ? 'road tax record'
            : sourceType === 'FUEL'
              ? 'fuel entry'
              : 'source record'
    return new DomainError(
      'VALIDATION_FAILED',
      `This cost comes from a ${source}. Edit that ${source} and the expense follows.`,
      422,
    )
  },
}
