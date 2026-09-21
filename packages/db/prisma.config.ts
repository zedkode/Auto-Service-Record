/**
 * Prisma 7 moved the connection URL out of schema.prisma.
 *   - `datasource.url` is what Migrate and Studio use.
 *   - `adapter` is what the runtime client uses (see src/client.ts).
 * Both read DATABASE_URL from the repository-root .env.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true })

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repository root.')
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: { url: connectionString },
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'node --experimental-strip-types prisma/seed.ts',
  },
  adapter: async () => new PrismaPg({ connectionString }),
})
