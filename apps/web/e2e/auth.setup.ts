import { test as setup } from '@playwright/test'
import { ORGANIZER_STORAGE_STATE } from '../playwright.config'
import { signInWithTicket } from './clerk-ticket'

// Signs the persistent organizer in via a Clerk sign-in ticket (see
// clerk-ticket.ts for why the UI cannot be used) and persists the browser
// state for the actual tests.
const ORGANIZER_EMAIL = 'e2e-organizer@example.com'

setup('authenticate as organizer', async ({ page }) => {
  await signInWithTicket(page, ORGANIZER_EMAIL, {
    firstName: 'E2E',
    lastName: 'Organizer',
  })
  await page.context().storageState({ path: ORGANIZER_STORAGE_STATE })
})
