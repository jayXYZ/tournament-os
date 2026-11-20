import { toScoreSlip } from './pairing-row'
import type { PairingRow } from './pairing-row'
import { ScoreSlipResult } from '@/components/shared/score-slip'

export function MatchResultCell({ row }: { row: PairingRow }) {
  return <ScoreSlipResult row={toScoreSlip(row)} />
}
