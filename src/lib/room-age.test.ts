import { describe, expect, it } from 'vitest'
import { ACTIVE_ROOM_MAX_AGE_MS, membershipsToRetire, RETIRE_BATCH } from './room-age'

const NOW = Date.parse('2026-11-18T12:00:00.000Z')
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()

describe('membershipsToRetire', () => {
  it('retires only memberships older than the max age', () => {
    const rows = [
      { recordId: 'fresh', createdAt: at(5 * 60 * 1000) },
      { recordId: 'edge', createdAt: at(ACTIVE_ROOM_MAX_AGE_MS) },
      { recordId: 'old', createdAt: at(ACTIVE_ROOM_MAX_AGE_MS + 1) },
    ]
    expect(membershipsToRetire(rows, NOW).map((r) => r.recordId)).toEqual(['old'])
  })

  it('takes the oldest first, at most RETIRE_BATCH', () => {
    const rows = Array.from({ length: RETIRE_BATCH + 10 }, (_, i) => ({
      recordId: `r${i}`,
      createdAt: at(ACTIVE_ROOM_MAX_AGE_MS + (i + 1) * 1000), // r0 is the newest old one
    }))
    const picked = membershipsToRetire(rows, NOW)
    expect(picked).toHaveLength(RETIRE_BATCH)
    expect(picked[0].recordId).toBe(`r${RETIRE_BATCH + 9}`)
    expect(picked.map((r) => r.recordId)).not.toContain('r0')
  })

  it('keeps rows whose createdAt cannot be read', () => {
    expect(membershipsToRetire([{ recordId: 'bad', createdAt: 'not a date' }], NOW)).toEqual([])
  })
})
