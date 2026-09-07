import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})

test('sign-in readiness, registration, and cancellation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in to register' }).click()
  await expect(
    page.getByRole('button', { name: 'Checking your registration' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Register for this event' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Finish sign-in' }).click()
  await page.getByRole('button', { name: 'Register for this event' }).click()
  await expect(
    page.getByText("You're registered", { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel registration' }).click()
  await expect(
    page.getByRole('button', { name: 'Register for this event' }),
  ).toBeVisible()
  await expect(page.getByTestId('mutation-calls')).toHaveText(
    JSON.stringify([
      {
        name: 'tournaments/registrations:registerSelf',
        args: { tournamentId: 'tournament' },
      },
      {
        name: 'tournaments/registrations:cancelMyRegistration',
        args: { tournamentId: 'tournament' },
      },
    ]),
  )
})

test('an existing badge stays loading until Convex auth is ready', async ({
  page,
}) => {
  await page.goto('/?scenario=badge')
  await expect(
    page.getByRole('button', { name: 'Checking your registration' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Register', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Finish sign-in' }).click()
  await expect(
    page.getByText("You're registered — General admission"),
  ).toBeVisible()
})

async function hold(page: Page, name: string, success: string) {
  const button = page.getByRole('button', { name, exact: true })
  await expect(button).toBeEnabled()
  await button.focus()
  await page.keyboard.down('Space')
  await expect(
    page.getByRole('status').filter({ hasText: success }),
  ).toBeVisible()
  await page.keyboard.up('Space')
  await expect(
    page.getByRole('status').filter({ hasText: success }),
  ).toHaveCount(0)
}

test('organizer progression dispatches the correct commands and updates the timeline', async ({
  page,
}) => {
  await page.goto('/?scenario=organizer')
  await hold(
    page,
    'Hold to publish and open registration',
    'Registration opened',
  )
  await hold(page, 'Hold to generate pairings', 'Pairings generated')
  await hold(page, 'Hold to publish pairings', 'Pairings published')
  await expect(
    page.getByRole('button', {
      name: 'Hold to start round timer',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByTestId('mutation-calls')).toHaveText(
    JSON.stringify([
      {
        name: 'tournaments/lifecycle:publishTournament',
        args: { tournamentId: 'tournament' },
      },
      {
        name: 'tournaments/rounds:startTournament',
        args: { tournamentId: 'tournament' },
      },
      {
        name: 'tournaments/rounds:publishPairings',
        args: { roundId: 'round' },
      },
    ]),
  )
})
