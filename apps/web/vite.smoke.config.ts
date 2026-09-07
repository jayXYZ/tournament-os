import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A separate test entry point: these adapters cannot enter the production
// build or bypass authentication in the deployed application.
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))
export default defineConfig({
  root: local('./e2e/smoke'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^convex\/react$/,
        replacement: local('./e2e/smoke/adapters.ts'),
      },
      {
        find: '@/lib/use-app-auth',
        replacement: local('./e2e/smoke/adapters.ts'),
      },
      { find: '@', replacement: local('./src') },
    ],
  },
  server: { host: '127.0.0.1', port: 3100, strictPort: true },
})
