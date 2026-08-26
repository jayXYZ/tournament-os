# Environment variables

Each surface has a committed `.env.example` documenting its local file; this
page is the full contract, including where each variable lives in production.
`.env.local` files are gitignored and hold real values.

## Web app (`apps/web`)

Local: copy `apps/web/.env.example` to `apps/web/.env.local`.
Production: set in the Vercel project (except `VITE_CONVEX_URL`, see below).

| Variable                                                                                                                                   | Required | Purpose                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CONVEX_URL`                                                                                                                          | yes      | Convex deployment URL. Local: from `packages/backend/.env.local` after `npx convex dev`. Production: injected by `convex deploy --cmd-url-env-var-name VITE_CONVEX_URL` in `apps/web/vercel.json` — do not set it manually in Vercel. |
| `VITE_CLERK_PUBLISHABLE_KEY`                                                                                                               | yes      | Clerk publishable key, read implicitly by the Clerk SDK. Same Clerk app as native.                                                                                                                                                    |
| `CLERK_SECRET_KEY`                                                                                                                         | yes      | Clerk secret key for SSR/server functions. Server-only; never expose with a `VITE_` prefix.                                                                                                                                           |
| `VITE_CLERK_SIGN_IN_URL`, `VITE_CLERK_SIGN_UP_URL`, `VITE_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `VITE_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | no       | Clerk routing, read implicitly by the Clerk SDK (`/sign-in`, `/sign-up`, `/`, `/`).                                                                                                                                                   |
| `VITE_SENTRY_DSN`                                                                                                                          | no       | Enables web error reporting; see [error-monitoring.md](./error-monitoring.md).                                                                                                                                                        |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`                                                                                        | no       | Build-time source-map upload; upload activates only when `SENTRY_AUTH_TOKEN` is set.                                                                                                                                                  |

## Native app (`apps/native`)

Local: copy `apps/native/.env.example` to `apps/native/.env.local`.
Release builds: set in the EAS build environment.

| Variable                                            | Required | Purpose                                                                           |
| --------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_CONVEX_URL`                            | yes      | Same Convex deployment URL as the web app's `VITE_CONVEX_URL`.                    |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`                 | yes      | Publishable key from the same Clerk app as web.                                   |
| `EXPO_PUBLIC_SENTRY_DSN`                            | no       | Enables native error reporting; see [error-monitoring.md](./error-monitoring.md). |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | no       | Build-time source-map/dSYM upload via the Sentry Expo plugin.                     |

## Convex deployment (`packages/backend`)

These live on the Convex deployment itself, not in a local file: set them with
`npx convex env set <NAME> <value>` from `packages/backend` (or in the Convex
dashboard). They are declared with types in `convex/convex.config.ts` via
`defineApp({ env })`, so a deploy fails fast if a required variable is missing,
and functions read them through the typed `env` object from
`convex/_generated/server` instead of `process.env`.

| Variable                     | Required   | Purpose                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLERK_JWT_ISSUER_DOMAIN`    | yes        | Clerk JWT issuer URL (e.g. `https://<slug>.clerk.accounts.dev`), consumed by `convex/auth.config.ts`. Without it, every request is anonymous.                                                                                                                                                     |
| `PROFILE_RESULTS_CURSOR_KEY` | production | Secret encrypting profile-results pagination cursors. Dev/test deployments fall back to a source-baked constant (`convex/model/playerResults.ts`); production must set a real random secret.                                                                                                      |
| `STRIPE_SECRET_KEY`          | payments   | Stripe API key for the platform account — use a [restricted key](https://docs.stripe.com/keys/restricted-api-keys) (`rk_…`) scoped to Connect accounts, Checkout Sessions, PaymentIntents (read), Refunds, and Transfers. Payment functions refuse with "Payments are not configured" when unset. |
| `STRIPE_WEBHOOK_SECRET`      | payments   | Signing secret for the Stripe webhook endpoint (`<deployment>.convex.site/stripe/events`). Dev: from `stripe listen --forward-to <dev-deployment>.convex.site/stripe/events`. Production: from the endpoint registered in the Stripe dashboard.                                                   |
| `WEB_APP_ORIGIN`             | payments   | Web app origin (e.g. `https://example.com`) used to build Stripe redirect URLs — Connect onboarding return/refresh and Checkout success/cancel. Stripe requires HTTPS for Account Link URLs even in test mode, so local onboarding needs an HTTPS tunnel or a deployed preview.                   |

`packages/backend/.env.local` (`CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, …) is
written by `npx convex dev` when linking a dev deployment; it is machine-local
state, not part of the contract.

Production Vercel builds additionally need `CONVEX_DEPLOY_KEY` in the Vercel
project so the build command in `apps/web/vercel.json` can run `convex deploy`.
