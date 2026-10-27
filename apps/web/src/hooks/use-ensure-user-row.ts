import { useCallback, useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { mutationErrorMessage } from '@paper-pairings/core'

import { api } from '@paper-pairings/backend/convex/_generated/api'

/**
 * A Clerk session can exist before its users row does (first visit), so
 * api.users.me stays null until something creates the row. Running upsertMe on
 * mount creates it — Convex reactivity then re-renders any subscribed query —
 * and refreshes name/avatar from the identity on later visits. `failure` holds
 * the message when the upsert rejects — the backend's own refusal when it is
 * one written for the user (an account with no name), else a generic one — so
 * callers whose UI blocks on the row can show it instead of loading forever;
 * `retry` clears it and re-runs the upsert.
 */
export function useEnsureUserRow() {
  const upsertMe = useMutation(api.users.upsertMe)
  const [failure, setFailure] = useState<string | null>(null)

  const retry = useCallback(() => {
    setFailure(null)
    upsertMe().catch((error: unknown) =>
      setFailure(
        mutationErrorMessage(
          error,
          'Something went wrong while setting up your player account. Check your connection and try again.',
        ),
      ),
    )
  }, [upsertMe])

  useEffect(() => {
    retry()
  }, [retry])

  return { failure, retry }
}
