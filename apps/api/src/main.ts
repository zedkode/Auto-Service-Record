import 'reflect-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true })

const { Logger } = await import('@nestjs/common')
const { loadApiConfig } = await import('@autoservices/config')
const { createApp } = await import('./bootstrap.js')

async function main(): Promise<void> {
  const logger = new Logger('Bootstrap')

  // Fails fast and loudly on a missing, malformed or placeholder value.
  const config = loadApiConfig()

  // Belt and braces: packages/config already refuses this combination, and so does the route.
  if (config.isProduction && config.DEV_AUTH_ENABLED) {
    throw new Error('FATAL: DEV_AUTH_ENABLED cannot be true in production.')
  }

  const app = await createApp({
    sessionSecret: config.SESSION_SECRET,
    corsOrigins: [config.APP_URL, config.ADMIN_URL, config.MARKETING_URL],
    isProduction: config.isProduction,
    logger: config.isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
  })

  await app.listen(config.API_PORT, '0.0.0.0')

  logger.log(`API listening on ${config.API_URL} (prefix /api/v1)`)
  logger.log(`Health: ${config.API_URL}/api/v1/health`)
  if (config.DEV_AUTH_ENABLED) {
    logger.warn(
      'DEV AUTH IS ENABLED — POST /api/v1/auth/dev-login issues a session without a password',
    )
  }
}

main().catch((err) => {
  console.error('Failed to start API:', err)
  process.exit(1)
})
