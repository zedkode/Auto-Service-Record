import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), '../..'), '')
  return {
    plugins: [react(), tailwindcss()],
    server: { port: Number(env.MARKETING_PORT ?? 3100), strictPort: true, host: true },
    define: { __APP_URL__: JSON.stringify(env.APP_URL ?? 'http://localhost:3101') },
    build: { outDir: 'dist', sourcemap: true },
  }
})
