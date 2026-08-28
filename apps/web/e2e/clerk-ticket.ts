import type { Page } from '@playwright/test'

// The app signs in with Google OAuth only, which cannot be driven headlessly.
// Instead the suite mints Clerk sign-in tickets with the Backend API and
// activates the session through window.Clerk. auth.setup.ts uses this for
// the persistent organizer; specs that need a second identity (e.g. a player
// joining an event) sign their own contexts in with a different email.

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

/**
 * Signs the page's browser context into the app as the given user, creating
 * the Clerk user on first use. Users persist in the Clerk dev instance
 * across runs (the pre-production Convex database may be wiped
 * independently), so lookups come first.
 */
export async function signInWithTicket(
  page: Page,
  email: string,
  name: { firstName: string; lastName: string },
) {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is not set — the E2E suite reads it from apps/web/.env.local.',
    )
  }

  const existing = await clerkApi<Array<ClerkUser>>(
    secretKey,
    `/v1/users?email_address=${encodeURIComponent(email)}`,
  )
  const user =
    existing[0] ??
    (await clerkApi<ClerkUser>(secretKey, '/v1/users', {
      method: 'POST',
      body: {
        email_address: [email],
        first_name: name.firstName,
        last_name: name.lastName,
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
}
