/**
 * WKWebView (Tauri's webview on macOS) does not implement async iteration of
 * ReadableStream, but pdf.js relies on `for await … of stream` both on the
 * main thread (getTextContent) and in its worker (DecompressionStream reads).
 * Without this, opening any PDF fails with
 * "undefined is not a function (near '…a of e…')".
 *
 * Side-effect module: import it before pdf.js code runs, in every JS context
 * that runs pdf.js (main thread and the pdf.js worker entry).
 */

// TS's DOM lib already types ReadableStream as async-iterable, so probe the
// prototype untyped — the runtime may still lack it.
const proto = ReadableStream.prototype as {
  values?: (options?: { preventCancel?: boolean }) => AsyncIterableIterator<unknown>
  [Symbol.asyncIterator]?: (options?: { preventCancel?: boolean }) => AsyncIterableIterator<unknown>
}

if (proto[Symbol.asyncIterator] === undefined) {
  proto.values = function (
    this: ReadableStream,
    { preventCancel = false }: { preventCancel?: boolean } = {},
  ): AsyncIterableIterator<unknown> {
    const reader = this.getReader()
    return {
      async next() {
        try {
          const result = await reader.read()
          if (result.done) reader.releaseLock()
          return { done: result.done, value: result.value }
        } catch (err) {
          reader.releaseLock()
          throw err
        }
      },
      async return(value?: unknown) {
        if (preventCancel) {
          reader.releaseLock()
        } else {
          const cancelled = reader.cancel(value)
          reader.releaseLock()
          await cancelled
        }
        return { done: true, value }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }
  proto[Symbol.asyncIterator] = proto.values
}

export {}
