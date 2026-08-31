import { useCallback, useEffect, useState } from 'react'
import { useMutation } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'

/**
 * A Clerk session can exist before its users row does (first visit), so
 * api.users.me stays null until something creates the row. Running upsertMe on
 * mount creates it — Convex reactivity then re-renders any subscribed query —
 * and refreshes name/avatar from the identity on later visits. `failed` flips
 * when the upsert rejects so callers whose UI blocks on the row can show an
 * error instead of loading forever; `retry` clears it and re-runs the upsert.
 */
export function useEnsureUserRow() {
  const upsertMe = useMutation(api.users.upsertMe)
  const [failed, setFailed] = useState(false)

  const retry = useCallback(() => {
    setFailed(false)
    upsertMe().catch(() => setFailed(true))
  }, [upsertMe])

  useEffect(() => {
    retry()
  }, [retry])

  return { failed, retry }
}
