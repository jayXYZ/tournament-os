import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Give slow reactive updates (Convex round-trips) more room than the default
// expect timeout without inflating every assertion in the suite.
const ADVANCE_TIMEOUT = 30_000

export const ORGANIZATION_NAME = 'E2E Test Organization'

export function advanceButton(page: Page, label: string): Locator {
  return page
    .locator('nav[aria-label="Tournament progress"]')
    .getByRole('button', { name: label })
}

/**
 * Presses a HoldButton the way a user does: pointer down on its center, keep
 * holding past the 800ms hold duration, release. The component completes the
 * action as soon as the fill reaches 100%, so the extra hold time only buys
 * safety margin on slow frames.
 */
export async function holdToConfirm(page: Page, button: Locator) {
  await expect(button).toBeEnabled({ timeout: ADVANCE_TIMEOUT })
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  if (!box) {
    throw new Error('Hold button has no bounding box; is it visible?')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1500)
  await page.mouse.up()
}

/**
 * Waits for the tournament's single advance action to reach the given step
 * (the board recomputes it reactively after each mutation), then holds it.
 */
export async function advanceStep(page: Page, label: string) {
  const button = advanceButton(page, label)
  await expect(button).toBeVisible({ timeout: ADVANCE_TIMEOUT })
  await holdToConfirm(page, button)
}

/**
 * Radix menu items are divs, so a disabled one still accepts the click and
 * silently drops onSelect. Wait out the aria-disabled window (queries the
 * item depends on may still be loading) before selecting.
 */
export async function clickMenuItem(page: Page, name: string | RegExp) {
  const item = page.getByRole('menuitem', { name })
  await expect(item).not.toHaveAttribute('aria-disabled', 'true')
  await item.click()
}

// The organizer user persists across runs (and the pre-production dev
// database may be wiped independently), so the workspace may or may not
// exist yet. The switcher menu itself reports which case we're in.
export async function ensureOrganization(page: Page) {
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

/**
 * Creates a fixed-round Swiss test event through the create dialog and opens
 * its manager workspace. Returns the manager's URL path (which embeds the
 * public tournament code) for direct navigation to its sub-pages.
 */
export async function createTestTournament(
  page: Page,
  options: { name: string; playerCount: number; roundCount: number },
): Promise<string> {
  await page.getByRole('button', { name: 'Create new tournament' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create tournament' })
  await dialog.getByLabel('Name').fill(options.name)
  await dialog.getByLabel('Start date').fill(tomorrowAtSixPm())
  await dialog.getByLabel('Capacity').fill(String(options.playerCount))
  await dialog.getByLabel('Mark as test event').check()
  await dialog
    .getByRole('combobox')
    .filter({ hasText: 'Dynamic rounds' })
    .click()
  await page.getByRole('option', { name: 'Fixed rounds' }).click()
  await dialog.getByLabel('Total rounds').fill(String(options.roundCount))
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page
    .getByRole('row', { name: new RegExp(options.name) })
    .getByRole('link', { name: 'Manage' })
    .click()
  await expect(page).toHaveURL(/\/admin\/tournaments\/[^/]+$/)
  return new URL(page.url()).pathname
}

/** Fills the registration list to capacity with generated test users. */
export async function seedTestPlayers(
  page: Page,
  managerUrl: string,
  count: number,
) {
  await page.goto(`${managerUrl}/registrations`)
  await page.getByRole('button', { name: 'Registration settings' }).click()
  await clickMenuItem(page, 'Generate Test Users')
  await expect(
    page.getByText(
      `${count} test ${count === 1 ? 'user' : 'users'} generated.`,
    ),
  ).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(count)
}

/**
 * Records a result through the organizer's Enter-result dialog for the nth
 * non-bye match on the pairings page. Re-entering a match that already has a
 * result is the active-round correction path — the same dialog overrides it.
 */
export async function enterResult(
  page: Page,
  matchIndex: number,
  playerOneWins: number,
  playerTwoWins: number,
) {
  await page
    .getByRole('button', { name: /^Manage table \d+$/ })
    .nth(matchIndex)
    .click()
  await clickMenuItem(page, 'Enter result')
  const dialog = page.getByRole('dialog', { name: 'Enter match result' })
  const gameWins = dialog.getByRole('spinbutton')
  await gameWins.nth(0).fill(String(playerOneWins))
  await gameWins.nth(1).fill(String(playerTwoWins))
  await dialog.getByRole('button', { name: 'Save result' }).click()
  await expect(dialog).toBeHidden()
}

function tomorrowAtSixPm(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  date.setHours(18, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
