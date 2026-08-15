import { useState } from 'react'
import { ClipboardPen, MoreHorizontal } from 'lucide-react'

import { EnterResultDialog } from './enter-result-dialog'
import type { BestOf } from '@tournament-os/shared/match-structure'
import type { PairingRow } from './pairing-row'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ManageMatchMenu({
  row,
  bestOf,
}: {
  row: PairingRow
  bestOf: BestOf
}) {
  const isBye = row.players.some((player) => player.isBye)
  const [enteringResult, setEnteringResult] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={
              row.match.tableNumber === undefined
                ? 'Manage bye match'
                : `Manage table ${row.match.tableNumber}`
            }
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={isBye}
              onSelect={() => setEnteringResult(true)}
            >
              <ClipboardPen />
              Enter result
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {enteringResult ? (
        <EnterResultDialog
          row={row}
          bestOf={bestOf}
          open={enteringResult}
          onOpenChange={setEnteringResult}
        />
      ) : null}
    </>
  )
}
