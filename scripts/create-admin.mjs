/**
 * Creates a staff account for the admin console (ADMIN-001).
 *
 * Usage:  node scripts/create-admin.mjs <email> <role> [password]
 *   role: SUPER_ADMIN | OPERATIONS | SUPPORT | BILLING | READ_ONLY
 *
 * Prints the two-factor enrolment URI ONCE. The account cannot sign in until a code from
 * it has been confirmed, because two-factor is mandatory for staff (SECURITY.md §13).
 *
 * This is an ops tool, not a development shortcut: it works in any environment, always
 * requires a real password, and never creates an account that can be used without 2FA.
 */
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

// Prisma 7 requires a driver adapter, and the dependency is declared by @autoservices/db,
// so both are resolved from that package rather than from the repository root.
import { createRequire } from 'node:module'
const requireFromDb = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/db/package.json'),
)
const { PrismaClient } = requireFromDb('@prisma/client')
const { PrismaPg } = requireFromDb('@prisma/adapter-pg')
const { hashPassword, generateTotpSecret, sealSecret, totpUri } = await import(
  '../packages/auth/dist/index.js'
)

const ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'BILLING', 'READ_ONLY']

const [email, role, providedPassword] = process.argv.slice(2)
if (!email || !role) {
  console.error('Usage: node scripts/create-admin.mjs <email> <role> [password]')
  console.error(`Roles: ${ROLES.join(' | ')}`)
  process.exit(1)
}
if (!ROLES.includes(role)) {
  console.error(`Unknown role "${role}". Expected one of: ${ROLES.join(', ')}`)
  process.exit(1)
}

const secret = process.env.SESSION_SECRET ?? ''
if (secret.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters — it protects the MFA secret.')
  process.exit(1)
}

// A generated password is safer than a typed one and is shown once, like the 2FA secret.
const password = providedPassword ?? `${randomBytes(12).toString('base64url')}Aa1!`

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

try {
  const existing = await prisma.adminUser.findUnique({ where: { email } })
  if (existing) {
    console.error(`An admin account already exists for ${email}.`)
    process.exit(1)
  }

  const totpSecret = generateTotpSecret()
  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role,
      // Cannot sign in until a code is confirmed.
      status: 'PENDING_MFA',
      mfaSecret: sealSecret(totpSecret, secret),
    },
  })

  console.log(`\nAdmin account created: ${admin.email} (${admin.role})`)
  console.log(`\n  Password: ${password}`)
  if (!providedPassword) console.log('  ^ generated — store it in a password manager now.')
  console.log(`\n  Two-factor secret: ${totpSecret}`)
  console.log(
    `  Add to an authenticator app:\n  ${totpUri({ secret: totpSecret, account: email, issuer: 'AutoServices Admin' })}`,
  )
  console.log(
    '\nThis is the only time these are shown. Sign in at the admin app to confirm the\n' +
      'first code; the account stays unusable until you do.\n',
  )
} finally {
  await prisma.$disconnect()
}
