import { beforeEach, describe, expect, it, vi } from 'vitest'

// The leaderboard feeds a banner on every page, so its failure mode matters
// more than its happy path: a decoration must never take a page down.

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
  it('ranks callers by all-time calls, highest first', async () => {
    queryMock.mockResolvedValue([{ leonard: 312, william: 430 }])
    expect(await leaders()).toEqual([
      { name: 'William', calls: 430 },
      { name: 'Leonard', calls: 312 },
    ])
  })

  it('keeps both callers even when one has never dialled', async () => {
    queryMock.mockResolvedValue([{ leonard: 12, william: 0 }])
    expect(await leaders()).toEqual([
      { name: 'Leonard', calls: 12 },
      { name: 'William', calls: 0 },
    ])
  })

  it('treats SQL NULL sums (empty table) as zero, not NaN', async () => {
    queryMock.mockResolvedValue([{ leonard: null, william: null }])
    expect(await leaders()).toEqual([
      { name: 'Leonard', calls: 0 },
      { name: 'William', calls: 0 },
    ])
  })

  it('survives an empty result set without throwing', async () => {
    queryMock.mockResolvedValue([])
    expect(await leaders()).toEqual([
      { name: 'Leonard', calls: 0 },
      { name: 'William', calls: 0 },
    ])
  })

  it('a database outage yields an empty board, never a 500', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).leaders).toEqual([])
  })
})
