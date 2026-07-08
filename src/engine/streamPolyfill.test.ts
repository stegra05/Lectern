/**
 * Simulates WKWebView's missing ReadableStream async iteration (the cause of
 * "Could not read <file>.pdf: undefined is not a function (near '…a of e…')")
 * by stripping the native support before loading the polyfill.
 */
import { beforeAll, describe, expect, it } from 'vitest'

type MutableProto = Record<PropertyKey, unknown>

function makeStream(chunks: string[], onCancel?: () => void): ReadableStream<string> {
  let i = 0
  return new ReadableStream<string>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++])
      else controller.close()
    },
    cancel() {
      onCancel?.()
    },
  })
}

describe('streamPolyfill', () => {
  beforeAll(async () => {
    const proto = ReadableStream.prototype as unknown as MutableProto
    delete proto[Symbol.asyncIterator]
    delete proto.values
    expect(Symbol.asyncIterator in ReadableStream.prototype).toBe(false)
    await import('./streamPolyfill')
  })

  it('installs an async iterator on ReadableStream.prototype', () => {
    expect(Symbol.asyncIterator in ReadableStream.prototype).toBe(true)
  })

  it('supports for await over a stream', async () => {
    const seen: string[] = []
    for await (const chunk of makeStream(['a', 'b', 'c'])) {
      seen.push(chunk as string)
    }
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('cancels the stream when iteration exits early', async () => {
    let cancelled = false
    const stream = makeStream(['a', 'b', 'c'], () => {
      cancelled = true
    })
    for await (const chunk of stream) {
      expect(chunk).toBe('a')
      break
    }
    expect(cancelled).toBe(true)
  })
})
