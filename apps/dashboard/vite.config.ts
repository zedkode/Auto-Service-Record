import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  // Env lives at the repository root, not per-app.
  const env = loadEnv(mode, path.resolve(process.cwd(), '../..'), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.DASHBOARD_PORT ?? 3101),
      strictPort: true,
      host: true,
    },
    define: {
      __API_URL__: JSON.stringify(env.API_URL ?? 'http://localhost:4100'),
    },
    build: { outDir: 'dist', sourcemap: true },
  }
})
