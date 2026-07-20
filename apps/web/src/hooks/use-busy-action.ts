import { useCallback, useState } from 'react'
import { toast } from 'sonner'

/**
 * Shared busy state for async actions (usually Convex mutations): `run` sets
 * `busy` while the action is in flight and toasts the thrown error's message
 * (falling back to `failure`) when it rejects. Success side effects — toasts,
 * closing dialogs, resetting forms — belong inside the action itself.
 */
export function useBusyAction() {
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (action: () => Promise<unknown>, failure: string) => {
      setBusy(true)
      try {
        await action()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : failure)
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  return { busy, run }
}
