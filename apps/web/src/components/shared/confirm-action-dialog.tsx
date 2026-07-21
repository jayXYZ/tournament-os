import { useId, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

/**
 * Confirmation dialog around a single async action. While the action runs the
 * dialog locks open and the confirm button shows a spinner; on success the
 * dialog closes, on failure the error is toasted (via `useBusyAction`).
 *
 * Either pass `trigger` to render an inline trigger element, or control the
 * dialog with `open`/`onOpenChange` (needed when triggering from a dropdown
 * menu item, since the menu unmounts on select).
 */
export function ConfirmActionDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  icon,
  title,
  description,
  cancelLabel = 'Cancel',
  actionLabel,
  destructive = false,
  confirmationText,
  onConfirm,
  failureMessage,
}: {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  icon?: React.ReactNode
  title: React.ReactNode
  description: React.ReactNode
  cancelLabel?: string
  actionLabel: React.ReactNode
  destructive?: boolean
  /** When set, the action stays disabled until this text is typed verbatim. */
  confirmationText?: string
  onConfirm: () => Promise<void> | void
  failureMessage: string
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [typedConfirmation, setTypedConfirmation] = useState('')
  const confirmationInputId = useId()
  const { busy, run } = useBusyAction()

  const open = controlledOpen ?? internalOpen
  // Reset during the opening render so controlled dialogs cannot briefly
  // reuse confirmation text before an effect runs.
  const [previousOpen, setPreviousOpen] = useState(open)
  if (open !== previousOpen) {
    setPreviousOpen(open)
    if (open) {
      setTypedConfirmation('')
    }
  }

  function setOpen(next: boolean) {
    setInternalOpen(next)
    onOpenChange?.(next)
  }

  const confirmationMatches =
    confirmationText === undefined ||
    typedConfirmation.trim() === confirmationText

  async function handleConfirm() {
    await run(async () => {
      await onConfirm()
      setOpen(false)
    }, failureMessage)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) {
          return
        }
        setOpen(next)
      }}
    >
      {trigger !== undefined ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          {icon !== undefined ? (
            <AlertDialogMedia
              className={destructive ? 'text-destructive' : undefined}
            >
              {icon}
            </AlertDialogMedia>
          ) : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmationText !== undefined ? (
          <Field>
            <FieldLabel htmlFor={confirmationInputId}>
              Type <span className="font-semibold">{confirmationText}</span> to
              confirm
            </FieldLabel>
            <Input
              id={confirmationInputId}
              autoComplete="off"
              value={typedConfirmation}
              onChange={(event) => setTypedConfirmation(event.target.value)}
              disabled={busy}
            />
          </Field>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy || !confirmationMatches}
            onClick={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
