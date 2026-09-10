import { ScoreSlipResult } from './score-slip'
import type { PairingRow } from './pairing-row'

export function MatchResultCell({ row }: { row: PairingRow }) {
  return <ScoreSlipResult row={row} />
}
