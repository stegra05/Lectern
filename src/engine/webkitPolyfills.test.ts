import { describe, expect, it } from 'vitest'
import './webkitPolyfills'

type Upsert = Map<string, number[]> & {
  getOrInsert(key: string, defaultValue: number[]): number[]
  getOrInsertComputed(key: string, callback: (key: string) => number[]): number[]
}

describe('webkitPolyfills', () => {
  it('getOrInsert returns the existing value without overwriting', () => {
    const map = new Map([['a', [1]]]) as Upsert
    expect(map.getOrInsert('a', [2])).toEqual([1])
    expect(map.getOrInsert('b', [2])).toEqual([2])
    expect(map.get('b')).toEqual([2])
  })

  it('getOrInsertComputed computes only for missing keys', () => {
    const map = new Map([['a', [1]]]) as Upsert
    let calls = 0
    const make = () => {
      calls++
      return [9]
    }
    expect(map.getOrInsertComputed('a', make)).toEqual([1])
    expect(map.getOrInsertComputed('b', make)).toEqual([9])
    expect(map.getOrInsertComputed('b', make)).toEqual([9])
    expect(calls).toBe(1)
  })

  it('WeakMap gets the same methods', () => {
    const weak = WeakMap.prototype as { getOrInsert?: unknown; getOrInsertComputed?: unknown }
    expect(typeof weak.getOrInsert).toBe('function')
    expect(typeof weak.getOrInsertComputed).toBe('function')
  })

  it('Promise.withResolvers resolves through the returned handle', async () => {
    const { promise, resolve } = (
      Promise as typeof Promise & {
        withResolvers: <T>() => {
          promise: Promise<T>
          resolve: (value: T) => void
          reject: (reason?: unknown) => void
        }
      }
    ).withResolvers<string>()
    resolve('ok')
    await expect(promise).resolves.toBe('ok')
  })
})
