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

// Four players give round 1 two tables: one reports a played result, the
// other stays unreported so the mid-round drop has a match to concede. A
// single fixed round keeps the run minimal — the between-rounds drop and its
// bye are covered by the corrections spec.
const PLAYER_COUNT = 4

test('mid-round drop: an unreported match is conceded to the opponent', async ({
  page,
}) => {
  await page.goto('/admin')
  await ensureOrganization(page)
  const managerUrl = await createTestTournament(page, {
    name: `E2E Mid-Round Drop ${Date.now()}`,
    playerCount: PLAYER_COUNT,
    roundCount: 1,
  })

  await advanceStep(page, 'Hold to publish and open registration')
  await seedTestPlayers(page, managerUrl, PLAYER_COUNT)

  await advanceStep(page, 'Hold to generate pairings')
  await advanceStep(page, 'Hold to publish pairings')
  await page.goto(`${managerUrl}/pairings`)
  await expect(page.getByText('Awaiting result')).toHaveCount(2)

  // Table 1 reports normally; its 2–1 scoreline stays distinct from the
  // concession's required-wins–0 so the assertions can't cross-match.
  await enterResult(page, 0, 2, 1)
  await expect(page.getByText('wins 2–1')).toBeVisible()

  // Capture table 2's players: the first one drops mid-round, the second
  // inherits the concession win.
  const tableTwoRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Manage table 2' }) })
  const playerParagraphs = tableTwoRow.locator('td').nth(1).locator('p')
  const droppedName = (await playerParagraphs.nth(0).innerText())
    .replace(/ vs\.$/, '')
    .trim()
  const opponentName = (await playerParagraphs.nth(1).innerText()).trim()

  // -- Drop while their match is still unreported ---------------------------
  await page.goto(`${managerUrl}/registrations`)
  await page.getByRole('button', { name: `Manage ${droppedName}` }).click()
  await clickMenuItem(page, 'Drop player')
  const dropDialog = page.getByRole('alertdialog', {
    name: `Drop ${droppedName}?`,
  })
  // The dialog itself warns about the match consequence before confirming.
  await expect(dropDialog.getByText(/conceded to their opponent/)).toBeVisible()
  await dropDialog.getByRole('button', { name: 'Drop player' }).click()
  await expect(page.getByText(`${droppedName} has been dropped.`)).toBeVisible()

  // -- The unfinished match became an immediate concession ------------------
  await page.goto(`${managerUrl}/pairings`)
  await expect(page.getByText('Awaiting result')).toHaveCount(0)
  await expect(page.getByText(`${opponentName} wins 2–0`)).toBeVisible()

  // The concession lands as its own typed audit event naming the dropped
  // player, not as an ordinary result entry.
  await page.goto(`${managerUrl}/log`)
  await expect(
    page.getByText(
      `${droppedName} conceded by dropping: ${droppedName} 0–2 ${opponentName} (round 1, table 2)`,
    ),
  ).toBeVisible()

  // -- The concession filled the round's last result, so play concludes -----
  await advanceStep(page, 'Hold to complete round and post standings')
  await advanceStep(page, 'Hold to complete tournament')
  await expect(advanceButton(page, 'Tournament complete')).toBeVisible()

  await page.goto(`${managerUrl}/standings`)
  await expect(page.locator('tbody tr')).toHaveCount(PLAYER_COUNT)
  await expect(page.getByText('Dropped', { exact: true })).toBeVisible()
})
