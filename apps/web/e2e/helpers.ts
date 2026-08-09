import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Give slow reactive updates (Convex round-trips) more room than the default
// expect timeout without inflating every assertion in the suite.
const ADVANCE_TIMEOUT = 30_000

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
