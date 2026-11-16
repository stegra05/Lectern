import { describe, expect, it } from 'vitest'
import { pace } from '../src/adapters/pace.ts'

/** A clock that only moves when the pace sleeps. */
function clock() {
  const state = { t: 0 }
  return {
    state,
    now: () => state.t,
    sleep: (ms: number) => {
      state.t += ms
      return Promise.resolve()
    },
  }
}

const answered =
  (tokens: number, limit = 1000) =>
  () =>
    Promise.resolve({ reply: tokens, limit, tokens })

describe('pacing calls to tokens a minute', () => {
  it('sends the first call alone, and the rest once it has told the limit', async () => {
    const c = clock()
    const p = pace(c.now, c.sleep)
    const started: number[] = []
    let release!: () => void
    const firstDone = new Promise<void>((resolve) => (release = resolve))
    const first = p.run(100, async () => {
      started.push(1)
      await firstDone
      return { reply: 1, limit: 1000, tokens: 100 }
    })
    const second = p.run(100, async () => {
      started.push(2)
      return { reply: 2, limit: 1000, tokens: 100 }
    })
    await Promise.resolve()
    expect(started).toEqual([1])
    release()
    expect(await Promise.all([first, second])).toEqual([1, 2])
    expect(started).toEqual([1, 2])
  })

  it('waits for the oldest call of the last minute to leave room', async () => {
    const c = clock()
    const p = pace(c.now, c.sleep)
    // 90 percent of 1000: 400 and 400 fit, the third 400 waits a minute.
    await p.run(400, answered(400))
    await p.run(400, answered(400))
    expect(c.state.t).toBe(0)
    await p.run(400, answered(400))
    expect(c.state.t).toBe(60_000)
  })

  it('counts a call at what it really used once it is answered', async () => {
    const c = clock()
    const p = pace(c.now, c.sleep)
    await p.run(800, answered(100))
    await p.run(800, answered(100))
    expect(c.state.t).toBe(0)
  })

  it('runs a call larger than the whole limit alone', async () => {
    const c = clock()
    const p = pace(c.now, c.sleep)
    await p.run(100, answered(100))
    await p.run(5000, answered(5000))
    expect(c.state.t).toBe(60_000)
  })

  it('lets the next call find the limit when the first one fails', async () => {
    const c = clock()
    const p = pace(c.now, c.sleep)
    await expect(p.run(100, () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(await p.run(100, answered(100))).toBe(100)
  })
})
