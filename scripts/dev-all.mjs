#!/usr/bin/env node
/**
 * Single-command local development runner.
 *
 *   pnpm dev:all
 *
 * Starts the API, worker, marketing site, dashboard and admin console in one
 * foreground process with prefixed, colourised output, and shuts them all down
 * cleanly on Ctrl-C. Docker infrastructure is managed separately (docker compose up -d)
 * because its lifecycle is longer than a dev session's.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import net from 'node:net'
import dotenv from 'dotenv'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env'), quiet: true })

const env = process.env
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  grey: '\x1b[90m',
}

const SERVICES = [
  {
    name: 'api',
    colour: C.cyan,
    cwd: 'apps/api',
    cmd: 'node',
    args: ['--enable-source-maps', 'dist/main.js'],
    port: Number(env.API_PORT ?? 4100),
    build: true,
  },
  {
    name: 'worker',
    colour: C.magenta,
    cwd: 'apps/worker',
    cmd: 'node',
    args: ['--enable-source-maps', 'dist/main.js'],
    port: null,
    build: true,
  },
  {
    name: 'marketing',
    colour: C.green,
    cwd: 'apps/marketing',
    cmd: 'pnpm',
    args: ['exec', 'vite', '--port', String(env.MARKETING_PORT ?? 3100), '--strictPort'],
    port: Number(env.MARKETING_PORT ?? 3100),
  },
  {
    name: 'dashboard',
    colour: C.blue,
    cwd: 'apps/dashboard',
    cmd: 'pnpm',
    args: ['exec', 'vite', '--port', String(env.DASHBOARD_PORT ?? 3101), '--strictPort'],
    port: Number(env.DASHBOARD_PORT ?? 3101),
  },
  {
    name: 'admin',
    colour: C.yellow,
    cwd: 'apps/admin',
    cmd: 'pnpm',
    args: ['exec', 'vite', '--port', String(env.ADMIN_PORT ?? 3102), '--strictPort'],
    port: Number(env.ADMIN_PORT ?? 3102),
  },
]

const width = Math.max(...SERVICES.map((s) => s.name.length))

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function preflight() {
  console.log(`${C.bold}AutoServices — local development${C.reset}\n`)

  // A built dist is required for the node-run services; Vite compiles on the fly.
  for (const s of SERVICES.filter((s) => s.build)) {
    const entry = path.join(root, s.cwd, 'dist/main.js')
    if (!fs.existsSync(entry)) {
      console.error(
        `${C.red}✗ ${s.name}: dist/main.js is missing. Run "pnpm build" first.${C.reset}`,
      )
      process.exit(1)
    }
  }

  const conflicts = []
  for (const s of SERVICES.filter((s) => s.port)) {
    if (await portInUse(s.port)) conflicts.push(s)
  }
  if (conflicts.length) {
    console.error(
      `${C.red}✗ Ports already in use: ${conflicts.map((c) => `${c.name}:${c.port}`).join(', ')}${C.reset}`,
    )
    console.error(
      `${C.dim}  Another dev session may already be running. Stop it, or change the ports in .env.${C.reset}`,
    )
    process.exit(1)
  }

  // Infrastructure is a separate lifecycle; warn rather than start it implicitly.
  const pg = await portInUse(Number(env.POSTGRES_PORT ?? 55432))
  const redis = await portInUse(Number(env.REDIS_PORT ?? 56379))
  if (!pg || !redis) {
    console.error(
      `${C.red}✗ Infrastructure is not running (postgres:${pg ? 'up' : 'down'}, redis:${redis ? 'up' : 'down'}).${C.reset}`,
    )
    console.error(`${C.dim}  Start it with: docker compose up -d${C.reset}`)
    process.exit(1)
  }
  console.log(`${C.green}✓${C.reset} infrastructure reachable (postgres, redis)\n`)
}

const children = []
let shuttingDown = false

function start(service) {
  const child = spawn(service.cmd, service.args, {
    cwd: path.join(root, service.cwd),
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const label = `${service.colour}${service.name.padEnd(width)}${C.reset} ${C.grey}│${C.reset}`
  const pipe = (stream, isError) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim())
          console.log(`${label} ${isError ? C.red : ''}${line}${isError ? C.reset : ''}`)
      }
    })
  }
  pipe(child.stdout, false)
  pipe(child.stderr, true)

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`${label} ${C.red}exited (code=${code} signal=${signal})${C.reset}`)
  })

  children.push({ service, child })
  return child
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n${C.dim}Shutting down (${signal})…${C.reset}`)
  for (const { child } of children) child.kill('SIGTERM')
  // Give the worker a moment to finish its current job before forcing the issue.
  setTimeout(() => {
    for (const { child } of children) if (!child.killed) child.kill('SIGKILL')
    process.exit(0)
  }, 3000)
}

await preflight()
for (const s of SERVICES) start(s)

setTimeout(() => {
  console.log(`\n${C.bold}Ready${C.reset}`)
  console.log(`  ${C.green}Marketing${C.reset}  http://localhost:${env.MARKETING_PORT ?? 3100}`)
  console.log(`  ${C.blue}Dashboard${C.reset}  http://localhost:${env.DASHBOARD_PORT ?? 3101}`)
  console.log(`  ${C.yellow}Admin${C.reset}      http://localhost:${env.ADMIN_PORT ?? 3102}`)
  console.log(
    `  ${C.cyan}API${C.reset}        http://localhost:${env.API_PORT ?? 4100}/api/v1/health`,
  )
  console.log(`  ${C.grey}Mailpit    http://localhost:${env.MAILPIT_UI_PORT ?? 58025}${C.reset}`)
  console.log(`  ${C.grey}MinIO      http://localhost:${env.MINIO_CONSOLE_PORT ?? 59001}${C.reset}`)
  console.log(`\n${C.dim}Ctrl-C to stop everything.${C.reset}\n`)
}, 3500)

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
