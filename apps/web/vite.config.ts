import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'

// Sentry org/project values are URL slugs (or a numeric project ID). The most
// common misconfiguration is pasting the DSN or the auth token into these
// variables, which sentry-cli rejects at upload time after the build has
// otherwise succeeded. Catch that before the build starts instead.
const SLUG_OR_ID = /^[a-z0-9][a-z0-9_-]*$/i

function requireSentrySlug(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} must be set when SENTRY_AUTH_TOKEN is set (source-map upload needs the org and project slugs). See docs/error-monitoring.md.`,
    )
  }
  if (!SLUG_OR_ID.test(value)) {
    throw new Error(
      `${name} must be a Sentry URL slug (or numeric project ID), not a DSN, URL, or auth token. See docs/error-monitoring.md.`,
    )
  }
  return value
}

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
              org: requireSentrySlug('SENTRY_ORG', env.SENTRY_ORG),
              project: requireSentrySlug('SENTRY_PROJECT', env.SENTRY_PROJECT),
              authToken: sentryAuthToken,
              // The plugin's default handler only logs upload failures and
              // lets the build exit 0, so a broken upload goes unnoticed
              // until the first unsymbolicated stack trace. Upload is opt-in
              // (token set), so when it is requested, failing is the right
              // signal.
              errorHandler: (error) => {
                throw error
              },
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
