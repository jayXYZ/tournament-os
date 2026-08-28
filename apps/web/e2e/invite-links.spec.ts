import { expect, test } from '@playwright/test'
import { signInWithTicket } from './clerk-ticket'
import {
  advanceStep,
  createTestTournament,
  ensureOrganization,
} from './helpers'

// Invite links end to end (see CONTEXT.md "Invite Link"): the organizer makes
// an event private and mints an invite link from the settings card; without
// the link the event is invisible and closed, and through /join/<code> a
// player the event has never admitted views it — signed out first — and
// registers. The grant's full boundary (rotation, disabling, entry decisions,
// capacity, setup secrecy) is pinned by inviteLinks.convex.spec.ts; this
// spec covers the browser path those specs cannot: the join route's
// redirect, the ?invite param, and the settings card.
const PLAYER_COUNT = 4
const INVITEE_EMAIL = 'e2e-invitee@example.com'

test('a player joins a private event through its invite link', async ({
  page,
  browser,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)

  const managerUrl = await createTestTournament(page, {
    name: `E2E Invite Links ${Date.now()}`,
    playerCount: PLAYER_COUNT,
    roundCount: 2,
  })
  const publicCode = managerUrl.split('/').at(-1)!
  const eventPath = `/tournaments/${publicCode}`

  await advanceStep(page, 'Hold to publish and open registration')
  await expect(page.getByText('Open for registration').first()).toBeVisible()

  // -- Make it private and mint the invite link ----------------------------
  await page.goto(`${managerUrl}/settings`)
  await page.getByLabel('Tournament visibility').click()
  await page.getByRole('option', { name: /^Private/ }).click()
  await expect(page.getByText('Visibility set to private.')).toBeVisible()

  await page.getByRole('button', { name: 'Create invite link' }).click()
  await expect(page.getByText('Invite link created.')).toBeVisible()
  const inviteUrl = await page.getByLabel('Invite link').inputValue()
  const joinPath = new URL(inviteUrl).pathname
  expect(joinPath).toMatch(/^\/join\/[0-9A-HJKMNP-TV-Z]{10}$/)

  // -- Signed out: the link is the only way in -----------------------------
  // browser.newContext() inherits the project's organizer storageState, so
  // both fresh contexts must reset it explicitly to actually change identity.
  const anonContext = await browser.newContext({
    baseURL: 'http://localhost:3000',
    storageState: { cookies: [], origins: [] },
  })
  const anonPage = await anonContext.newPage()

  await anonPage.goto(eventPath)
  await expect(anonPage.getByText('Tournament not found')).toBeVisible()

  await anonPage.goto('/join/0000000000')
  await expect(anonPage.getByText('Invite not found')).toBeVisible()

  await anonPage.goto(joinPath)
  await expect(anonPage).toHaveURL(new RegExp(`${eventPath}\\?invite=`))
  await expect(anonPage.getByText('E2E Invite Links')).toBeVisible()
  await expect(
    anonPage.getByRole('button', { name: 'Sign in to register' }),
  ).toBeVisible()
  await anonContext.close()

  // -- Signed in: the invited player registers through the link ------------
  const inviteeContext = await browser.newContext({
    baseURL: 'http://localhost:3000',
    storageState: { cookies: [], origins: [] },
  })
  const inviteePage = await inviteeContext.newPage()
  await signInWithTicket(inviteePage, INVITEE_EMAIL, {
    firstName: 'E2E',
    lastName: 'Invitee',
  })

  // Still no way in without the code, signed in or not.
  await inviteePage.goto(eventPath)
  await expect(inviteePage.getByText('Tournament not found')).toBeVisible()

  await inviteePage.goto(joinPath)
  await inviteePage
    .getByRole('button', { name: 'Register for this event' })
    .click()
  await expect(
    inviteePage.getByText("You're registered. See you at the event!"),
  ).toBeVisible()

  // The registration row itself now resolves the event, so the invited
  // player keeps access without carrying the invite param around.
  await inviteePage.goto(eventPath)
  await expect(inviteePage.getByText("You're registered")).toBeVisible()
  await inviteeContext.close()

  // -- The organizer sees the arrival on the roster ------------------------
  await page.goto(`${managerUrl}/registrations`)
  await expect(
    page.getByRole('row', { name: /E2E Invitee/ }).first(),
  ).toBeVisible()
})
