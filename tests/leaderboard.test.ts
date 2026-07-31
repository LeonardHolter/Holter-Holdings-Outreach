import { beforeEach, describe, expect, it, vi } from 'vitest'

// The leaderboard feeds a banner on every page, so its failure mode matters
// more than its happy path: a decoration must never take a page down.
//
// It now counts WON deals rather than dials, and the per-row attribution is
// resolved in SQL — so what's left to pin down here is the folding of those
// free-text caller names onto the roster, and the failure paths.

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(async (_sql?: unknown, _params?: unknown): Promise<Record<string, unknown>[]> => []),
}))
vi.mock('@/lib/db', () => ({ query: queryMock }))

import { GET } from '@/app/api/leaderboard/route'

const leaders = async () => (await (await GET()).json()).leaders

beforeEach(() => {
  queryMock.mockReset()
})

describe('leaderboard route', () => {
  it('ranks callers by all-time wins, highest first', async () => {
    queryMock.mockResolvedValue([
      { closed_by: 'Leonard', wins: 3 },
      { closed_by: 'William', wins: 5 },
    ])
    expect(await leaders()).toEqual([
      { name: 'William', wins: 5 },
      { name: 'Leonard', wins: 3 },
    ])
  })

  it('keeps both callers even when one has never won', async () => {
    queryMock.mockResolvedValue([{ closed_by: 'Leonard', wins: 2 }])
    expect(await leaders()).toEqual([
      { name: 'Leonard', wins: 2 },
      { name: 'William', wins: 0 },
    ])
  })

  it('folds stray casing onto the roster instead of splitting the tally', async () => {
    queryMock.mockResolvedValue([
      { closed_by: 'leonard', wins: 2 },
      { closed_by: ' Leonard ', wins: 1 },
    ])
    expect(await leaders()).toEqual([
      { name: 'Leonard', wins: 3 },
      { name: 'William', wins: 0 },
    ])
  })

  it('drops wins that could not be attributed to anyone', async () => {
    queryMock.mockResolvedValue([
      { closed_by: null, wins: 4 },
      { closed_by: 'Someone Else', wins: 2 },
      { closed_by: 'William', wins: 1 },
    ])
    expect(await leaders()).toEqual([
      { name: 'William', wins: 1 },
      { name: 'Leonard', wins: 0 },
    ])
  })

  it('survives an empty result set (nobody has won yet) without throwing', async () => {
    queryMock.mockResolvedValue([])
    expect(await leaders()).toEqual([
      { name: 'Leonard', wins: 0 },
      { name: 'William', wins: 0 },
    ])
  })

  it('a database outage yields an empty board, never a 500', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).leaders).toEqual([])
  })
})
