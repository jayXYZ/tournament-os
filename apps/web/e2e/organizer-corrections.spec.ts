import { expect, test } from '@playwright/test'
import {
  advanceButton,
  advanceStep,
  clickMenuItem,
  createTestTournament,
  ensureOrganization,
  enterResult,
  seedTestPlayers,
} from './helpers'

// Four players so round 1 has two clean tables; the mid-event drop then
// forces round 2 down to three actives, which must produce a bye.
const PLAYER_COUNT = 4

test('organizer corrections: override a live result, rewind pairings, drop into a bye', async ({
  page,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)
  const managerUrl = await createTestTournament(page, {
    name: `E2E Corrections ${Date.now()}`,
    playerCount: PLAYER_COUNT,
    roundCount: 2,
  })

  await advanceStep(page, 'Hold to publish and open registration')
  await seedTestPlayers(page, managerUrl, PLAYER_COUNT)

  // -- Round 1: report, then correct a live result --------------------------
  await advanceStep(page, 'Hold to generate pairings')
  await advanceStep(page, 'Hold to publish pairings')
  await page.goto(`${managerUrl}/pairings`)
  await expect(page.getByText('Awaiting result')).toHaveCount(2)

  // Capture table 1's player names so the correction can assert on the
  // flipped winner rather than a scoreline both results share.
  const tableOneRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Manage table 1' }) })
  const playerParagraphs = tableOneRow.locator('td').nth(1).locator('p')
  const playerOne = (await playerParagraphs.nth(0).innerText())
    .replace(/ vs\.$/, '')
    .trim()
  const playerTwo = (await playerParagraphs.nth(1).innerText()).trim()

  await enterResult(page, 0, 2, 0)
  await expect(page.getByText(`${playerOne} wins 2–0`)).toBeVisible()
  await enterResult(page, 1, 2, 0)

  // The correction: re-entering the match overrides the standing result and
  // flips the winner while the round is still active.
  await enterResult(page, 0, 0, 2)
  await expect(page.getByText(`${playerTwo} wins 2–0`)).toBeVisible()

  // The override is preserved in the audit trail with the superseded
  // scoreline, not silently replaced.
  await page.goto(`${managerUrl}/log`)
  await expect(page.getByText('Result edit').first()).toBeVisible()
  await expect(
    page.getByText(`Previous result: ${playerOne} 2–0 ${playerTwo}`),
  ).toBeVisible()

  await advanceStep(page, 'Hold to complete round and post standings')

  // -- Rewind: unpublish round 2 and reopen round 1 --------------------------
  await advanceStep(page, 'Hold to generate pairings')
  await page.goto(`${managerUrl}/pairings`)
  await page.getByRole('button', { name: 'Pairings settings' }).click()
  await clickMenuItem(page, 'Unpublish pairings and rewind')
  const rewindDialog = page.getByRole('alertdialog', {
    name: 'Unpublish round 2 pairings?',
  })
  await rewindDialog
    .getByRole('button', { name: 'Unpublish and rewind' })
    .click()
  await expect(
    page.getByText('Pairings unpublished. Round 1 reopened.'),
  ).toBeVisible()

  // Round 1's results survived the rewind, so it can complete again
  // immediately — nothing needs re-reporting.
  await advanceStep(page, 'Hold to complete round and post standings')

  // -- Drop: remove a player between rounds ---------------------------------
  await page.goto(`${managerUrl}/registrations`)
  const dropButton = page.getByRole('button', { name: /^Manage / }).first()
  const droppedName = (await dropButton.getAttribute('aria-label'))!.replace(
    /^Manage /,
    '',
  )
  await dropButton.click()
  await clickMenuItem(page, 'Drop player')
  const dropDialog = page.getByRole('alertdialog', {
    name: `Drop ${droppedName}?`,
  })
  await dropDialog.getByRole('button', { name: 'Drop player' }).click()
  await expect(page.getByText(`${droppedName} has been dropped.`)).toBeVisible()
  await expect(page.getByText('dropped', { exact: true })).toBeVisible()

  // -- Round 2: three actives pair into one table and a bye -----------------
  await advanceStep(page, 'Hold to generate pairings')
  await advanceStep(page, 'Hold to publish pairings')
  await page.goto(`${managerUrl}/pairings`)
  await expect(page.getByText('Bye', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Manage bye match' }),
  ).toBeVisible()
  // The bye auto-completes, leaving exactly one match to report.
  await expect(page.getByText('Awaiting result')).toHaveCount(1)

  await enterResult(page, 0, 2, 1)
  await advanceStep(page, 'Hold to complete round and post standings')

  // -- Complete: dropped player stays ranked with a frozen record -----------
  await advanceStep(page, 'Hold to complete tournament')
  await expect(advanceButton(page, 'Tournament complete')).toBeVisible()

  await page.goto(`${managerUrl}/standings`)
  await expect(page.locator('tbody tr')).toHaveCount(PLAYER_COUNT)
  await expect(page.getByText('Dropped', { exact: true })).toBeVisible()
})
