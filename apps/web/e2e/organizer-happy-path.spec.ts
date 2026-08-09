import { expect, test } from '@playwright/test'
import { advanceButton, advanceStep } from './helpers'
import type { Page } from '@playwright/test'

// Smallest deterministic shape that still exercises real Swiss play: two
// tables per round, no byes, and a fixed round count so the run never depends
// on the dynamic-rounds formula.
const PLAYER_COUNT = 4
const ROUND_COUNT = 2
const MATCHES_PER_ROUND = PLAYER_COUNT / 2

const ORGANIZATION_NAME = 'E2E Test Organization'

test('organizer happy path: create → publish → register → pair → report → complete', async ({
  page,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)

  // -- Create --------------------------------------------------------------
  const tournamentName = `E2E Happy Path ${Date.now()}`
  await page.getByRole('button', { name: 'Create new tournament' }).click()
  const createDialog = page.getByRole('dialog', { name: 'Create tournament' })
  await createDialog.getByLabel('Name').fill(tournamentName)
  await createDialog.getByLabel('Start date').fill(tomorrowAtSixPm())
  await createDialog.getByLabel('Capacity').fill(String(PLAYER_COUNT))
  await createDialog.getByLabel('Mark as test event').check()
  await createDialog
    .getByRole('combobox')
    .filter({ hasText: 'Dynamic rounds' })
    .click()
  await page.getByRole('option', { name: 'Fixed rounds' }).click()
  await createDialog.getByLabel('Total rounds').fill(String(ROUND_COUNT))
  await createDialog
    .getByRole('button', { name: 'Create', exact: true })
    .click()
  await expect(createDialog).toBeHidden()

  await page
    .getByRole('row', { name: new RegExp(tournamentName) })
    .getByRole('link', { name: 'Manage' })
    .click()
  await expect(page).toHaveURL(/\/admin\/tournaments\/[^/]+$/)
  const managerUrl = new URL(page.url()).pathname
  // The overview may repeat lifecycle wording inside the public-page preview,
  // so badge assertions pin to the first occurrence.
  await expect(page.getByText('Setup', { exact: true }).first()).toBeVisible()

  // -- Publish -------------------------------------------------------------
  await advanceStep(page, 'Hold to publish and open registration')
  await expect(page.getByText('Open for registration').first()).toBeVisible()

  // -- Register ------------------------------------------------------------
  await page.goto(`${managerUrl}/registrations`)
  await page.getByRole('button', { name: 'Registration settings' }).click()
  // The menu item stays aria-disabled until the tournament query resolves;
  // clicking a disabled Radix item dispatches but never fires onSelect.
  const generateUsers = page.getByRole('menuitem', {
    name: 'Generate Test Users',
  })
  await expect(generateUsers).not.toHaveAttribute('aria-disabled', 'true')
  await generateUsers.click()
  await expect(
    page.getByText(`${PLAYER_COUNT} test users generated.`),
  ).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(PLAYER_COUNT)

  // -- Pair and report each round ------------------------------------------
  for (let round = 1; round <= ROUND_COUNT; round++) {
    await advanceStep(page, 'Hold to generate pairings')
    await advanceStep(page, 'Hold to publish pairings')

    await page.goto(`${managerUrl}/pairings`)
    await expect(page.getByText('Awaiting result')).toHaveCount(
      MATCHES_PER_ROUND,
    )

    // Enter each result through the real organizer dialog rather than the
    // simulate-results shortcut; distinct scores also exercise the winner
    // summary text.
    for (let match = 0; match < MATCHES_PER_ROUND; match++) {
      const loserWins = match % 2
      await page
        .getByRole('button', { name: /^Manage table \d+$/ })
        .nth(match)
        .click()
      await page.getByRole('menuitem', { name: 'Enter result' }).click()
      const resultDialog = page.getByRole('dialog', {
        name: 'Enter match result',
      })
      const gameWins = resultDialog.getByRole('spinbutton')
      await gameWins.nth(0).fill('2')
      await gameWins.nth(1).fill(String(loserWins))
      await resultDialog.getByRole('button', { name: 'Save result' }).click()
      await expect(resultDialog).toBeHidden()
      await expect(page.getByText(`wins 2–${loserWins}`)).toBeVisible()
    }

    await advanceStep(page, 'Hold to complete round and post standings')
  }

  // -- Complete ------------------------------------------------------------
  await advanceStep(page, 'Hold to complete tournament')
  await expect(advanceButton(page, 'Tournament complete')).toBeVisible()

  await page.goto(`${managerUrl}/standings`)
  await expect(page.getByRole('columnheader', { name: 'Rank' })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(PLAYER_COUNT)

  await page.goto(managerUrl)
  await expect(
    page.getByText('Completed', { exact: true }).first(),
  ).toBeVisible()
})

// The organizer user persists across runs (and the pre-production dev
// database may be wiped independently), so the workspace may or may not
// exist yet. The switcher menu itself reports which case we're in.
async function ensureOrganization(page: Page) {
  const switcher = page.getByRole('button', {
    name: new RegExp(`Select organization|${ORGANIZATION_NAME}`),
  })
  await expect(switcher).toBeVisible()
  await switcher.click()

  const menu = page.getByRole('menu')
  await expect(menu.getByText('Loading…')).toBeHidden()
  const needsOrganization = await menu
    .getByText('No organizer workspaces')
    .isVisible()
  if (!needsOrganization) {
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    return
  }

  await menu.getByRole('menuitem', { name: 'Create organization' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create organization' })
  await dialog.getByLabel('Name').fill(ORGANIZATION_NAME)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Organizer workspace created.')).toBeVisible()
}

function tomorrowAtSixPm(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  date.setHours(18, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
