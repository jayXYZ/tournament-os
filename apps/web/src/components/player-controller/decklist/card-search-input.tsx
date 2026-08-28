import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { MAX_CARD_NAME_LENGTH } from '@tournament-os/shared/decklist-limits'

import { parseCardInput } from './decklist-draft'
import { useCardAutocomplete } from './use-card-autocomplete'
import type { BoardId } from './decklist-draft'
import { Badge } from '@/components/ui/badge'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

// The decklist add bar: one input that understands both a plain card name and
// a quantity-prefixed one ("4 Lightning Bolt"), with name suggestions from
// the card catalog. Selecting a suggestion — or pressing Enter — hands the
// parsed { name, quantity } to the editor and clears the bar for the next
// card, so a whole list can be entered without leaving the keyboard.
export function CardSearchInput({
  board,
  onAdd,
}: {
  board: BoardId
  onAdd: (name: string, quantity: number) => void
}) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const { quantity, name } = parseCardInput(value)
  const { suggestions, loading } = useCardAutocomplete(name)

  // Fall back to the verbatim text when the catalog has nothing, so an
  // outage (or a name the catalog doesn't know yet) never blocks entry.
  const options =
    suggestions.length > 0
      ? suggestions
      : !loading && name.length >= 2
        ? [name]
        : []
  const suggestionsPending = !dismissed && name.length >= 2 && loading
  const open = !dismissed && name.length >= 2 && options.length > 0
  const activeIndex = Math.min(highlight, Math.max(options.length - 1, 0))
  const activeOptionId = open ? `${listboxId}-option-${activeIndex}` : undefined

  useEffect(() => {
    if (!activeOptionId) {
      return
    }
    document
      .getElementById(activeOptionId)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId])

  function add(cardName: string) {
    const trimmed = cardName.trim()
    if (trimmed.length === 0) {
      return
    }
    onAdd(trimmed, quantity)
    setValue('')
    setHighlight(0)
    setDismissed(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length === 0) {
        return
      }
      setDismissed(false)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((activeIndex + step + options.length) % options.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      add(open ? options[activeIndex] : name)
      return
    }
    if (event.key === 'Escape' && (open || suggestionsPending)) {
      event.preventDefault()
      setDismissed(true)
    }
  }

  return (
    <div className="relative">
      <InputGroup>
        <InputGroupAddon>
          <Plus aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-busy={loading}
          aria-label={`Add cards to ${board}`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={MAX_CARD_NAME_LENGTH}
          placeholder={`Add to ${board} — try “4 Lightning Bolt”`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setHighlight(0)
            setDismissed(false)
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setDismissed(true)}
          onFocus={() => setDismissed(false)}
        />
        {quantity > 1 ? (
          <InputGroupAddon align="inline-end">
            <Badge variant="secondary" className="tabular-nums">
              ×{quantity}
            </Badge>
          </InputGroupAddon>
        ) : null}
        {loading && !dismissed ? (
          <InputGroupAddon align="inline-end">
            <Spinner className="size-3.5" />
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Card name suggestions"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((option, index) => (
            <li
              key={option}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                'flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm',
                index === activeIndex && 'bg-accent text-accent-foreground',
              )}
              // mousedown instead of click so the input never blurs: the
              // keyboard stays up and the next card can be typed immediately.
              onMouseDown={(event) => {
                event.preventDefault()
                add(option)
              }}
              onMouseMove={() => setHighlight(index)}
            >
              <span className="min-w-0 flex-1 truncate">{option}</span>
              {quantity > 1 ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  ×{quantity}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
