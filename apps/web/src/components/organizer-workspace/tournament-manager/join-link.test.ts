import { describe, expect, it } from 'vitest'

import { formatInviteCode, joinPath, joinQrCaption } from './join-link'

describe('join links', () => {
  it('puts either kind of code under /join', () => {
    expect(joinPath('7K3M9Q')).toBe('/join/7K3M9Q')
    expect(joinPath('ABCDEFGHJK')).toBe('/join/ABCDEFGHJK')
  })

  it('splits an invite code into two groups of five', () => {
    expect(formatInviteCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK')
  })

  it.each([
    [{ registrationRequiresApproval: false }, 'Scan to join'],
    [
      { registrationRequiresApproval: false, entryFeeCents: 1500 },
      'Scan to register — $15.00 entry',
    ],
    [{ registrationRequiresApproval: true }, 'Scan to request a spot'],
    // Approval comes first: scanning files an application either way, and
    // payment only follows approval.
    [
      { registrationRequiresApproval: true, entryFeeCents: 1500 },
      'Scan to request a spot',
    ],
  ])('captions %j as %j', (tournament, caption) => {
    expect(joinQrCaption(tournament)).toBe(caption)
  })
})
