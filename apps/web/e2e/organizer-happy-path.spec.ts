import { expect, test } from '@playwright/test'
import {
  advanceButton,
  advanceStep,
  createTestTournament,
  ensureOrganization,
  enterResult,
  seedTestPlayers,
} from './helpers'

// Smallest deterministic shape that still exercises real Swiss play: two
// tables per round, no byes, and a fixed round count so the run never depends
// on the dynamic-rounds formula.
const PLAYER_COUNT = 4
const ROUND_COUNT = 2
const MATCHES_PER_ROUND = PLAYER_COUNT / 2

test('organizer happy path: create → publish → register → pair → report → complete', async ({
  page,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)

  // -- Create --------------------------------------------------------------
  const managerUrl = await createTestTournament(page, {
    name: `E2E Happy Path ${Date.now()}`,
    playerCount: PLAYER_COUNT,
    roundCount: ROUND_COUNT,
  })
  // The overview may repeat lifecycle wording inside the public-page preview,
  // so badge assertions pin to the first occurrence.
  await expect(page.getByText('Setup', { exact: true }).first()).toBeVisible()

  // -- Publish -------------------------------------------------------------
  await advanceStep(page, 'Hold to publish and open registration')
  await expect(page.getByText('Open for registration').first()).toBeVisible()

  // -- Register ------------------------------------------------------------
  await seedTestPlayers(page, managerUrl, PLAYER_COUNT)

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
      await enterResult(page, match, 2, loserWins)
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
