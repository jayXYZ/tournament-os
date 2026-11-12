import { expect, test } from '@playwright/test'
import {
  advanceButton,
  advanceStep,
  clickMenuItem,
  createTestTournament,
  ensureOrganization,
  seedTestPlayers,
} from './helpers'
import type { Page } from '@playwright/test'

// Four players give round 1 two tables, one per adjudication: table 1 is
// forfeited, table 2 has a no-show. A single fixed round keeps the run
// minimal — both awards fill the round, so play concludes off them alone.
const PLAYER_COUNT = 4

test('adjudication: a forfeit and a no-show award their matches without play', async ({
  page,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)
  const managerUrl = await createTestTournament(page, {
    name: `E2E Adjudication ${Date.now()}`,
    playerCount: PLAYER_COUNT,
    roundCount: 1,
  })

  await advanceStep(page, 'Hold to publish and open registration')
  await seedTestPlayers(page, managerUrl, PLAYER_COUNT)

  await advanceStep(page, 'Hold to generate pairings')
  await advanceStep(page, 'Hold to publish pairings')
  await page.goto(`${managerUrl}/pairings`)
  await expect(page.getByLabel('Awaiting result')).toHaveCount(2)

  const tableOne = await tablePlayers(page, 1)
  const tableTwo = await tablePlayers(page, 2)

  // -- Forfeit: the first player at table 1 loses without play --------------
  await page.getByRole('button', { name: 'Manage table 1' }).click()
  await clickMenuItem(page, 'Record forfeit')
  const forfeitDialog = page.getByRole('dialog', { name: 'Record forfeit' })
  const recordForfeit = forfeitDialog.getByRole('button', {
    name: 'Record forfeit',
  })
  // Nothing is recorded until the organizer names who forfeits.
  await expect(recordForfeit).toBeDisabled()
  await forfeitDialog.getByLabel(`${tableOne.first} forfeits`).click()
  await forfeitDialog.getByLabel('Note (optional)').fill('Decklist penalty')
  await recordForfeit.click()
  await expect(forfeitDialog).toBeHidden()
  await expect(page.getByText(`${tableOne.second} wins 2–0`)).toBeVisible()
  await expect(page.getByText('Forfeit', { exact: true })).toBeVisible()

  // -- No-show: the second player at table 2 is absent ----------------------
  await page.getByRole('button', { name: 'Manage table 2' }).click()
  await clickMenuItem(page, 'Record no-show')
  const noShowDialog = page.getByRole('dialog', { name: 'Record no-show' })
  await noShowDialog.getByLabel(`${tableTwo.second} is absent`).click()
  await noShowDialog.getByRole('button', { name: 'Record no-show' }).click()
  await expect(noShowDialog).toBeHidden()
  await expect(page.getByText(`${tableTwo.first} wins 2–0`)).toBeVisible()
  await expect(page.getByText('No show', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Awaiting result')).toHaveCount(0)

  // -- Each lands as its own typed audit event, and the no-show dropped -----
  await page.goto(`${managerUrl}/log`)
  await expect(
    page.getByText(
      `${tableOne.first} forfeited: ${tableOne.first} 0–2 ${tableOne.second} (round 1, table 1)`,
    ),
  ).toBeVisible()
  await expect(
    page.getByText(
      `${tableTwo.second} was a no-show: ${tableTwo.first} 2–0 ${tableTwo.second} (round 1, table 2)`,
    ),
  ).toBeVisible()
  // The drop concedes nothing on top of the no-show.
  await expect(page.getByText(/conceded by dropping/)).toHaveCount(0)

  // -- The awards filled the round, so play concludes -----------------------
  await advanceStep(page, 'Hold to complete round and post standings')
  await advanceStep(page, 'Hold to complete tournament')
  await expect(advanceButton(page, 'Tournament complete')).toBeVisible()

  // Only the absent player was dropped: a forfeit keeps its player in.
  await page.goto(`${managerUrl}/standings`)
  await expect(page.locator('tbody tr')).toHaveCount(PLAYER_COUNT)
  await expect(page.getByText('Dropped', { exact: true })).toHaveCount(1)
})

// The two names on a table's score slip, in the order the slip lists them.
async function tablePlayers(page: Page, tableNumber: number) {
  const row = page.getByRole('row').filter({
    has: page.getByRole('button', { name: `Manage table ${tableNumber}` }),
  })
  const paragraphs = row.locator('td').nth(1).locator('p')
  return {
    first: (await paragraphs.nth(0).innerText()).replace(/ vs\.$/, '').trim(),
    second: (await paragraphs.nth(1).innerText()).trim(),
  }
}
