import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), '../..'), '')
  return {
    plugins: [react(), tailwindcss()],
    server: { port: Number(env.ADMIN_PORT ?? 3102), strictPort: true, host: true },
    define: {
      __API_URL__: JSON.stringify(env.API_URL ?? 'http://localhost:4100'),
      // DEVELOPMENT ONLY. Phase 9 replaces this with a real admin session (ADMIN-001).
      // Intentionally sourced from the same secret the scheduler uses so there is one
      // thing to rotate, and the endpoints behind it expose operational data only.
    },
    build: { outDir: 'dist', sourcemap: true },
  }
})
