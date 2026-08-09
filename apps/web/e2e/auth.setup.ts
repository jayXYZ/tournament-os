import { test as setup } from '@playwright/test'
import { ORGANIZER_STORAGE_STATE } from '../playwright.config'

// The app signs in with Google OAuth only, which cannot be driven headlessly.
// Instead this setup project mints a Clerk sign-in ticket with the Backend
// API and activates the session through window.Clerk, then persists the
// browser state for the actual tests.
const ORGANIZER_EMAIL = 'e2e-organizer@example.com'

type ClerkUser = { id: string }

async function clerkApi<T>(
  secretKey: string,
  apiPath: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`https://api.clerk.com${apiPath}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) {
    throw new Error(
      `Clerk API ${apiPath} failed with ${response.status}: ${await response.text()}`,
    )
  }
  return (await response.json()) as T
}

setup('authenticate as organizer', async ({ page }) => {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is not set — the E2E suite reads it from apps/web/.env.local.',
    )
  }

  const existing = await clerkApi<Array<ClerkUser>>(
    secretKey,
    `/v1/users?email_address=${encodeURIComponent(ORGANIZER_EMAIL)}`,
  )
  const user =
    existing[0] ??
    (await clerkApi<ClerkUser>(secretKey, '/v1/users', {
      method: 'POST',
      body: {
        email_address: [ORGANIZER_EMAIL],
        first_name: 'E2E',
        last_name: 'Organizer',
        skip_password_requirement: true,
      },
    }))

  const ticket = await clerkApi<{ token: string }>(
    secretKey,
    '/v1/sign_in_tokens',
    { method: 'POST', body: { user_id: user.id } },
  )

  await page.goto('/')
  await page.waitForFunction(() => window.Clerk?.loaded === true)
  await page.evaluate(async (token) => {
    const clerk = window.Clerk!
    const result = await clerk.client!.signIn.create({
      strategy: 'ticket',
      ticket: token,
    })
    await clerk.setActive({ session: result.createdSessionId })
  }, ticket.token)
  await page.waitForFunction(() => window.Clerk?.user != null)

  await page.context().storageState({ path: ORGANIZER_STORAGE_STATE })
})
