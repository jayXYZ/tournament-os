import { useEffect, useId, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { ArrowRightLeft, EllipsisVertical, Lock, Minus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { MAX_DECK_NAME_LENGTH } from '@tournament-os/shared/decklist-limits'
import { CardSearchInput } from './card-search-input'
import {
  MAX_QUANTITY,
  addToBoard,
  boardCount,
  draftsEqual,
  moveBetweenBoards,
  otherBoard,
  removeFromBoard,
  setBoardQuantity,
} from './decklist-draft'
import type { FunctionReturnType } from 'convex/server'

import type { BoardId, DecklistDraft, DraftEntry } from './decklist-draft'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type MyDecklist = NonNullable<
  FunctionReturnType<typeof api.tournaments.decklists.getMyDecklist>
>

// Which row the add bar last touched, so the list can flash (and scroll to)
// the confirmation. The nonce retriggers the flash when the same card is
// added twice in a row.
type FlashTarget = { board: BoardId; key: string; nonce: number }

function draftFromDecklist(decklist: MyDecklist['decklist']): DecklistDraft {
  return {
    deckName: decklist?.deckName ?? '',
    maindeck: decklist?.maindeck ?? [],
    sideboard: decklist?.sideboard ?? [],
  }
}

export function DecklistEditor({
  tournamentId,
  data,
  onDirtyChange,
}: {
  tournamentId: Id<'tournaments'>
  // `data.submissionOpen` stays live through query updates; `data.decklist`
  // only seeds the local draft, which is the source of truth from then on.
  data: MyDecklist
  // Live unsaved-changes signal for the page, which refuses to unmount a
  // dirty editor (destroying the draft) when the organizer turns decklist
  // collection off mid-edit.
  onDirtyChange: (dirty: boolean) => void
}) {
  const deckNameId = useId()
  const submitDecklist = useMutation(api.tournaments.decklists.submitMyDecklist)

  const [draft, setDraft] = useState<DecklistDraft>(() =>
    draftFromDecklist(data.decklist),
  )
  const [baseline, setBaseline] = useState<DecklistDraft>(draft)
  const [hasSubmitted, setHasSubmitted] = useState(data.decklist !== null)
  const [board, setBoard] = useState<BoardId>('maindeck')
  const [flash, setFlash] = useState<FlashTarget | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const flashNonce = useRef(0)

  const dirty = !draftsEqual(draft, baseline)
  const submissionOpen = data.submissionOpen

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  // The flash is one-shot: clear it once the 0.9s highlight animation (see
  // .deck-row-added in styles/app.css) has finished, so the row returns to
  // its resting key/class and a later remount (e.g. switching board tabs)
  // doesn't replay the animation or re-scroll.
  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => setFlash(null), 1000)
    return () => window.clearTimeout(timer)
  }, [flash])

  // A 75-card draft is minutes of typing — don't let one stray tap on the
  // back button discard it silently.
  useBlocker({
    shouldBlockFn: () =>
      !window.confirm(
        'You have unsaved decklist changes. Leave without submitting them?',
      ),
    enableBeforeUnload: () => dirty,
    disabled: !dirty,
  })

  function handleAdd(name: string, quantity: number) {
    setDraft((current) => ({
      ...current,
      [board]: addToBoard(current[board], name, quantity),
    }))
    flashNonce.current += 1
    setFlash({
      board,
      key: name.trim().toLowerCase(),
      nonce: flashNonce.current,
    })
  }

  function handleQuantity(boardId: BoardId, name: string, quantity: number) {
    setDraft((current) => ({
      ...current,
      [boardId]: setBoardQuantity(current[boardId], name, quantity),
    }))
  }

  function handleRemove(boardId: BoardId, name: string) {
    setDraft((current) => ({
      ...current,
      [boardId]: removeFromBoard(current[boardId], name),
    }))
  }

  function handleMove(boardId: BoardId, name: string) {
    setDraft((current) => moveBetweenBoards(current, boardId, name))
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await submitDecklist({
        tournamentId,
        deckName: draft.deckName.trim() || undefined,
        maindeck: draft.maindeck,
        sideboard: draft.sideboard,
      })
      setBaseline(draft)
      setHasSubmitted(true)
      toast.success('Decklist submitted.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not submit the decklist.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!submissionOpen && !hasSubmitted) {
    return (
      <Empty className="mt-4 min-h-80 border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Lock aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Submission is closed</EmptyTitle>
          <EmptyDescription>
            Decklists can no longer be submitted for this event, and you have
            none on file. Talk to the organizer if you still need to register
            one.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const mainCount = boardCount(draft.maindeck)
  const sideCount = boardCount(draft.sideboard)

  return (
    <>
      <div className="grid gap-4 pt-4">
        {!submissionOpen ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Submission is closed. This is the list the organizer has on
              file.
            </p>
          </div>
        ) : null}

        {submissionOpen ? (
          <Field>
            <FieldLabel htmlFor={deckNameId}>Deck name</FieldLabel>
            <Input
              id={deckNameId}
              value={draft.deckName}
              maxLength={MAX_DECK_NAME_LENGTH}
              placeholder="Optional — e.g. Boros Energy"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  deckName: event.target.value,
                }))
              }
            />
          </Field>
        ) : draft.deckName.trim() ? (
          <h2 className="text-lg font-semibold">{draft.deckName.trim()}</h2>
        ) : null}

        <Tabs
          value={board}
          onValueChange={(value) => setBoard(value as BoardId)}
          className="gap-3"
        >
          <TabsList className="w-full">
            <TabsTrigger value="maindeck">
              Maindeck ·&nbsp;<span className="tabular-nums">{mainCount}</span>
            </TabsTrigger>
            <TabsTrigger value="sideboard">
              Sideboard ·&nbsp;<span className="tabular-nums">{sideCount}</span>
            </TabsTrigger>
          </TabsList>
          {submissionOpen ? (
            <CardSearchInput board={board} onAdd={handleAdd} />
          ) : null}
          {(['maindeck', 'sideboard'] as const).map((boardId) => (
            <TabsContent key={boardId} value={boardId}>
              <BoardList
                board={boardId}
                entries={draft[boardId]}
                flash={flash}
                readOnly={!submissionOpen}
                onQuantity={handleQuantity}
                onRemove={handleRemove}
                onMove={handleMove}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {submissionOpen ? (
        <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3 sm:max-w-2xl sm:px-6">
            <div className="text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground tabular-nums">
                  {mainCount}
                </span>{' '}
                main ·{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {sideCount}
                </span>{' '}
                side
              </p>
              <p className="mt-0.5 text-[11px]">
                {dirty
                  ? 'Unsaved changes'
                  : hasSubmitted
                    ? 'Submitted'
                    : 'Not submitted yet'}
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              disabled={!dirty || submitting || draft.maindeck.length === 0}
              onClick={() => void handleSubmit()}
            >
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {hasSubmitted ? 'Update decklist' : 'Submit decklist'}
            </Button>
          </div>
        </footer>
      ) : null}
    </>
  )
}

function BoardList({
  board,
  entries,
  flash,
  readOnly,
  onQuantity,
  onRemove,
  onMove,
}: {
  board: BoardId
  entries: Array<DraftEntry>
  flash: FlashTarget | null
  readOnly: boolean
  onQuantity: (board: BoardId, name: string, quantity: number) => void
  onRemove: (board: BoardId, name: string) => void
  onMove: (board: BoardId, name: string) => void
}) {
  // Scroll to the row the add bar just touched — exactly once per add, from
  // an effect keyed on the flash target. An inline ref callback would get a
  // new identity every render, so React would detach/re-attach it and re-run
  // scrollIntoView on every unrelated state update (typing the deck name,
  // +/- on another row), yanking the viewport back to this row.
  const flashedRowRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (flash === null || flash.board !== board) return
    flashedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [flash, board])

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {readOnly
          ? `No ${board} cards were submitted.`
          : board === 'maindeck'
            ? 'No cards yet. Type a card name above to start your list.'
            : 'No sideboard cards yet. Cards you add on this tab land here.'}
      </div>
    )
  }

  return (
    <ul className="grid gap-1.5">
      {entries.map((entry) => {
        const key = entry.name.toLowerCase()
        const flashed =
          flash !== null && flash.board === board && flash.key === key
        return (
          <li
            // The nonce in the key remounts the flashed row so the animation
            // replays when the same card is added again back to back.
            key={flashed ? `${key}:${flash.nonce}` : key}
            ref={flashed ? flashedRowRef : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5',
              flashed && 'deck-row-added',
            )}
          >
            {readOnly ? (
              <span className="w-7 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                {entry.quantity}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-sm">
              {entry.name}
            </span>
            {readOnly ? null : (
              <>
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove one ${entry.name}`}
                    disabled={entry.quantity <= 1}
                    onClick={() =>
                      onQuantity(board, entry.name, entry.quantity - 1)
                    }
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <span className="w-7 text-center text-sm font-medium tabular-nums">
                    {entry.quantity}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Add one ${entry.name}`}
                    disabled={entry.quantity >= MAX_QUANTITY}
                    onClick={() =>
                      onQuantity(board, entry.name, entry.quantity + 1)
                    }
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`More actions for ${entry.name}`}
                    >
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => onMove(board, entry.name)}
                    >
                      <ArrowRightLeft aria-hidden="true" />
                      Move to {otherBoard(board)}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onRemove(board, entry.name)}
                    >
                      <Trash2 aria-hidden="true" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
