import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  // Source-map upload needs Sentry credentials; without them the build stays
  // a plain build (error reporting itself only needs VITE_SENTRY_DSN).
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN

  return {
    server: {
      port: 3000,
    },
    resolve: {
      // Native replacement for vite-tsconfig-paths (Vite 8+)
      tsconfigPaths: true,
    },
    plugins: [
      tailwindcss(),
      tanstackStart(),
      viteReact(),
      ...(sentryAuthToken
        ? [
            sentryTanstackStart({
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              authToken: sentryAuthToken,
            }),
          ]
        : []),
    ],
    // Workaround for https://github.com/TanStack/router/issues/5738
    optimizeDeps: {
      include: ['@clerk/tanstack-react-start', 'cookie'],
    },
  }
})
