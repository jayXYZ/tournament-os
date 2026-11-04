import { expect, test } from '@playwright/test'
import { signInWithTicket } from './clerk-ticket'
import {
  createTestTournament,
  ensureOrganization,
  holdToConfirm,
} from './helpers'

// A player has the event page open, signed in and unregistered; an organizer
// then enrolls them by email. The root-level sign-in (useEnsureUserRow)
// subscribes to the Claim signal and runs the Claim as the enrollment lands,
// so the open page shows them registered — no reload, no Register click, no
// visit to settings — and the organizer's roster shows the account's name in
// place of "Awaiting player details".
const PLAYER_EMAIL = 'e2e-enrolled-player@example.com'
const PLAYER_NAME = { firstName: 'Enrolled', lastName: 'Player' }

test('an email-enrolled player is claimed while their event page is open', async ({
  page,
  browser,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)
  const managerUrl = await createTestTournament(page, {
    name: `E2E Enrollment Claim ${Date.now()}`,
    playerCount: 4,
    roundCount: 1,
  })
  const publicCode = managerUrl.split('/').at(-1)!
  // The advance action sits in the live status band on this branch.
  await holdToConfirm(
    page,
    page.getByRole('button', { name: 'Hold to publish and open registration' }),
  )
  await expect(page.getByText('Open for registration').first()).toBeVisible()

  // -- The player opens the event page signed in, before any enrollment ----
  // browser.newContext() inherits the organizer storageState; reset it so
  // this context is the player's own.
  const playerContext = await browser.newContext({
    baseURL: 'http://localhost:3000',
    storageState: { cookies: [], origins: [] },
  })
  const playerPage = await playerContext.newPage()
  await signInWithTicket(playerPage, PLAYER_EMAIL, PLAYER_NAME)
  await playerPage.goto(`/tournaments/${publicCode}`)
  await expect(
    playerPage.getByRole('button', { name: 'Register for this event' }),
  ).toBeVisible({ timeout: 30_000 })

  // -- The organizer enrolls the email while that page stays open ----------
  await page.goto(`${managerUrl}/registrations`)
  await page.getByRole('button', { name: 'Enroll player' }).click()
  const dialog = page.getByRole('dialog', { name: 'Enroll a player' })
  await dialog.getByLabel('Email').fill(PLAYER_EMAIL)
  await dialog.getByRole('button', { name: 'Enroll player' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByText(`${PLAYER_EMAIL} has been enrolled.`, { exact: false }),
  ).toBeVisible()

  // -- The open page is claimed as the enrollment lands --------------------
  await expect(playerPage.getByText("You're registered")).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    playerPage.getByRole('button', { name: 'Cancel registration' }),
  ).toBeVisible()
  await expect(
    playerPage.getByRole('button', { name: 'Register for this event' }),
  ).toHaveCount(0)
  await playerContext.close()

  // -- The organizer sees the account's name on the same entry -------------
  await page.reload()
  const namedRow = page.getByRole('row', {
    name: new RegExp(`${PLAYER_NAME.firstName} ${PLAYER_NAME.lastName}`),
  })
  await expect(namedRow).toBeVisible()
  await expect(namedRow.getByText('Awaiting player details')).toHaveCount(0)
  await expect(page.locator('tbody tr')).toHaveCount(1)
})
