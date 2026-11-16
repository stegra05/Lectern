import { describe, expect, it, vi } from 'vitest'
import { slideCache } from './slideCache.ts'

describe('slideCache', () => {
  it('reads a picture once', async () => {
    const read = vi.fn().mockResolvedValue('data:a')
    const load = slideCache()
    expect(await load('c/1/1', read)).toBe('data:a')
    expect(await load('c/1/1', read)).toBe('data:a')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('tries a failed read again the next time it is asked for', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('gone')).mockResolvedValue('data:a')
    const load = slideCache()
    expect(await load('c/1/1', read)).toBeNull()
    expect(await load('c/1/1', read)).toBe('data:a')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('tries again after a read that found no picture', async () => {
    const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValue('data:a')
    const load = slideCache()
    expect(await load('c/1/1', read)).toBeNull()
    expect(await load('c/1/1', read)).toBe('data:a')
  })
})
