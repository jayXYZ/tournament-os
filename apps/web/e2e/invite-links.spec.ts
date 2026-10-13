import { expect, test } from '@playwright/test'
import { signInWithTicket } from './clerk-ticket'
import {
  advanceStep,
  createTestTournament,
  ensureOrganization,
} from './helpers'
import type { Browser, Locator, Page } from '@playwright/test'

// Join links and invite links end to end (see CONTEXT.md "Public Code",
// "Invite Link", and "Join QR"). A public event shares /join/<public code>
// and its QR code from the settings card, and going private stops that link
// admitting anyone. A private event shares its invite link instead: without
// it the event is invisible and closed, and through /join/<code> a player
// the event has never admitted views it — signed out first — and registers.
// Rotating or disabling the invite asks first. The grant's full boundary
// (rotation, disabling, entry decisions, capacity, setup secrecy) is pinned
// by inviteLinks.convex.spec.ts and joinCodes.convex.spec.ts; this spec
// covers the browser path those specs cannot: the join route's redirect,
// the ?invite param, the settings card, and the QR dialog.
const PLAYER_COUNT = 4
const INVITEE_EMAIL = 'e2e-invitee@example.com'
const BASE_URL = 'http://localhost:3000'
const CODE_CHARACTER = '[0-9A-HJKMNP-TV-Z]'

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
  expect(joinPath).toMatch(new RegExp(`^/join/${CODE_CHARACTER}{10}$`))

  // The QR code encodes the same link and splits the code for typing.
  const inviteCode = joinPath.split('/').at(-1)!
  const qr = await openJoinQr(page, 'Show QR code')
  await expect(qr.getByText(inviteUrl, { exact: true })).toBeVisible()
  await expect(
    qr.getByText(`${inviteCode.slice(0, 5)}-${inviteCode.slice(5)}`),
  ).toBeVisible()
  await expect(qr.locator('svg > title')).toHaveCount(1)
  await expect(qr.getByText(/This QR code is the invite/)).toBeVisible()
  await closeDialog(page, qr)

  // -- Signed out: the link is the only way in -----------------------------
  const anonPage = await signedOutPage(browser)

  await anonPage.goto(eventPath)
  await expect(anonPage.getByText('Tournament not found')).toBeVisible()

  await anonPage.goto('/join/0000000000')
  await expect(anonPage.getByText('Code not found')).toBeVisible()

  await anonPage.goto(joinPath)
  await expect(anonPage).toHaveURL(new RegExp(`${eventPath}\\?invite=`))
  await expect(anonPage.getByText('E2E Invite Links')).toBeVisible()
  await expect(
    anonPage.getByRole('button', { name: 'Sign in to register' }),
  ).toBeVisible()

  // -- Signed in: the invited player registers through the link ------------
  const inviteePage = await signedOutPage(browser)
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
  await inviteePage.context().close()

  // -- The organizer sees the arrival on the roster ------------------------
  await page.goto(`${managerUrl}/registrations`)
  await expect(
    page.getByRole('row', { name: /E2E Invitee/ }).first(),
  ).toBeVisible()

  // -- Regenerating asks first, then kills the old link --------------------
  await page.goto(`${managerUrl}/settings`)
  await page.getByRole('button', { name: 'Regenerate' }).click()
  let confirm = page.getByRole('alertdialog', {
    name: 'Regenerate the invite link?',
  })
  await expect(confirm.getByText(/every printed QR code/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByLabel('Invite link')).toHaveValue(inviteUrl)

  await page.getByRole('button', { name: 'Regenerate' }).click()
  await confirm.getByRole('button', { name: 'Regenerate' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByLabel('Invite link')).not.toHaveValue(inviteUrl)
  const rotatedPath = new URL(await page.getByLabel('Invite link').inputValue())
    .pathname

  await anonPage.goto(joinPath)
  await expect(anonPage.getByText('Code not found')).toBeVisible()
  await anonPage.goto(rotatedPath)
  await expect(anonPage).toHaveURL(new RegExp(`${eventPath}\\?invite=`))

  // -- Disabling asks first, then leaves nothing to share ------------------
  await page.getByRole('button', { name: 'Disable' }).click()
  confirm = page.getByRole('alertdialog', { name: 'Disable the invite link?' })
  await expect(confirm.getByText(/every printed QR code/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Disable link' }).click()
  await expect(confirm).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Create invite link' }),
  ).toBeVisible()

  await anonPage.goto(rotatedPath)
  await expect(anonPage.getByText('Code not found')).toBeVisible()
  await anonPage.context().close()
})

test('a public event shares its join link and QR code until it goes private', async ({
  page,
  browser,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)

  const name = `E2E Join Link ${Date.now()}`
  const managerUrl = await createTestTournament(page, {
    name,
    playerCount: PLAYER_COUNT,
    roundCount: 2,
  })
  const publicCode = managerUrl.split('/').at(-1)!
  expect(publicCode).toMatch(new RegExp(`^${CODE_CHARACTER}{6}$`))
  const joinUrl = `${BASE_URL}/join/${publicCode}`

  // -- Setup: nothing to print yet -----------------------------------------
  let qr = await openJoinQr(page, 'QR code')
  await expect(
    qr.getByText('Publish the event to get a QR code.'),
  ).toBeVisible()
  await expect(qr.locator('svg > title')).toHaveCount(0)
  await closeDialog(page, qr)

  await advanceStep(page, 'Hold to publish and open registration')
  await expect(page.getByText('Open for registration').first()).toBeVisible()

  // -- Published: the share card and the QR code carry the public code -----
  await page.goto(`${managerUrl}/settings`)
  await expect(page.getByLabel('Join link')).toHaveValue(joinUrl)
  qr = await openJoinQr(page, 'Show QR code')
  await expect(qr.getByText(joinUrl, { exact: true })).toBeVisible()
  await expect(qr.locator('svg > title')).toHaveText(`QR code to join ${name}`)
  await expect(qr.getByText('Scan to join')).toBeVisible()
  await expect(qr.getByText(publicCode, { exact: true })).toBeVisible()
  await closeDialog(page, qr)

  const anonPage = await signedOutPage(browser)
  await anonPage.goto(`/join/${publicCode}`)
  await expect(anonPage).toHaveURL(new RegExp(`/tournaments/${publicCode}$`))
  await expect(anonPage.getByText(name)).toBeVisible()

  // -- Private: the same link now admits nobody ----------------------------
  await page.getByLabel('Tournament visibility').click()
  await page.getByRole('option', { name: /^Private/ }).click()
  await expect(page.getByText('Visibility set to private.')).toBeVisible()
  // The card follows: a private event shares an invite link instead.
  await expect(page.getByLabel('Join link')).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Create invite link' }),
  ).toBeVisible()

  await anonPage.goto(`/join/${publicCode}`)
  await expect(anonPage.getByText('Code not found')).toBeVisible()
  await anonPage.context().close()

  // -- Closed: registration is over, so there is no code to scan -----------
  await page.getByRole('button', { name: 'Cancel event' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel event' })
    .click()
  await expect(page.getByText('Tournament cancelled.')).toBeVisible()
  await page.goto(managerUrl)
  qr = await openJoinQr(page, 'QR code')
  await expect(
    qr.getByText("Registration is closed, so there's nothing to scan."),
  ).toBeVisible()
  await expect(qr.locator('svg > title')).toHaveCount(0)
})

async function openJoinQr(page: Page, buttonName: string) {
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Join QR code' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeDialog(page: Page, dialog: Locator) {
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

// browser.newContext() inherits the project's organizer storageState, so a
// fresh context must reset it explicitly to actually change identity.
async function signedOutPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  })
  return await context.newPage()
}
