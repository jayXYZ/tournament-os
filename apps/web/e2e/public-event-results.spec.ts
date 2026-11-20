import { expect, test } from '@playwright/test'
import {
  advanceStep,
  createTestTournament,
  ensureOrganization,
  enterResult,
  seedTestPlayers,
} from './helpers'
import type { Browser } from '@playwright/test'

// Public Results end to end (see CONTEXT.md "Public Results"): a signed-out
// visitor on a public event page follows the matches and standings live. The
// organizer's result entry and round completion reach the visitor's open
// page with no reload, and a round whose pairings are still held shows
// nothing. The access and projection boundary is pinned by
// publicResults.convex.spec.ts; this spec covers the browser path: the
// page's sections, their live updates, and the signed-out session.
const PLAYER_COUNT = 4
const MATCHES_PER_ROUND = PLAYER_COUNT / 2

test('a signed-out visitor follows matches and standings live', async ({
  page,
  browser,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)

  const managerUrl = await createTestTournament(page, {
    name: `E2E Public Results ${Date.now()}`,
    playerCount: PLAYER_COUNT,
    roundCount: 2,
  })
  const publicCode = managerUrl.split('/').at(-1)!
  await advanceStep(page, 'Hold to publish and open registration')
  await seedTestPlayers(page, managerUrl, PLAYER_COUNT)

  // -- Before play: the page says where results will appear ----------------
  const visitor = await signedOutPage(browser, new URL(page.url()).origin)
  await visitor.goto(`/tournaments/${publicCode}`)
  await expect(
    visitor.getByText('They appear here once the event begins'),
  ).toBeVisible()

  // -- Held pairings stay hidden -------------------------------------------
  await page.goto(managerUrl)
  await advanceStep(page, 'Hold to generate pairings')
  await expect(visitor.getByRole('tab', { name: 'Matches' })).toBeVisible()
  await expect(visitor.getByText('No pairings yet')).toBeVisible()

  // -- Released: the visitor's page fills in without a reload -------------
  await advanceStep(page, 'Hold to publish pairings')
  const results = visitor.getByRole('region', {
    name: 'Pairings and standings',
  })
  await expect(results.getByText('Round 1', { exact: true })).toBeVisible()
  await expect(results.getByLabel('Awaiting result')).toHaveCount(
    MATCHES_PER_ROUND,
  )

  // -- An organizer result appears live -----------------------------------
  await page.goto(`${managerUrl}/pairings`)
  await enterResult(page, 0, 2, 0)
  await expect(results.getByText(/wins 2–0/)).toBeVisible()
  await expect(results.getByLabel('Awaiting result')).toHaveCount(
    MATCHES_PER_ROUND - 1,
  )
  await enterResult(page, 1, 2, 1)
  await expect(results.getByText(/wins 2–1/)).toBeVisible()

  // -- Completing the round posts standings to the open page --------------
  await advanceStep(page, 'Hold to complete round and post standings')
  await expect(results.getByText('Finished')).toBeVisible()
  await results.getByRole('tab', { name: 'Standings' }).click()
  await expect(results.getByText('After Round 1')).toBeVisible()
  await expect(results.locator('button[aria-expanded]')).toHaveCount(
    PLAYER_COUNT,
  )

  await visitor.context().close()
})

// browser.newContext() inherits the project's organizer storageState, so a
// fresh context must reset it explicitly to actually change identity.
async function signedOutPage(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  return await context.newPage()
}
