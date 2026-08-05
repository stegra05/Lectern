/**
 * WKWebView (Tauri's webview on macOS) tracks the installed Safari's WebKit,
 * and pdf.js 6.x calls two builtins newer than what Intel-Mac-era systems
 * ship: Map/WeakMap `getOrInsertComputed` (Safari 26 — Intel Macs top out at
 * Sequoia's Safari 18.x) and `Promise.withResolvers` (Safari 17.4). Without
 * this, opening any PDF fails with
 * "this._intentStates.getOrInsertComputed is not a function".
 *
 * Side-effect module: import it before pdf.js code runs, in every JS context
 * that runs pdf.js (main thread and the pdf.js worker entry), like
 * ./streamPolyfill. Remaining hard floor is Safari 16.4 (DecompressionStream,
 * which pdf.js needs and cannot be polyfilled here).
 */

interface UpsertProto {
  has(key: unknown): boolean
  get(key: unknown): unknown
  set(key: unknown, value: unknown): unknown
  getOrInsert?(key: unknown, defaultValue: unknown): unknown
  getOrInsertComputed?(key: unknown, callback: (key: unknown) => unknown): unknown
}

for (const proto of [Map.prototype, WeakMap.prototype] as unknown as UpsertProto[]) {
  if (proto.getOrInsert === undefined) {
    proto.getOrInsert = function (key, defaultValue) {
      if (!this.has(key)) this.set(key, defaultValue)
      return this.get(key)
    }
  }
  if (proto.getOrInsertComputed === undefined) {
    proto.getOrInsertComputed = function (key, callback) {
      if (!this.has(key)) this.set(key, callback(key))
      return this.get(key)
    }
  }
}

// tsconfig's lib predates es2024, so probe the constructor untyped — the
// runtime may have it (Safari 17.4+) or not.
const promiseCtor = Promise as typeof Promise & {
  withResolvers?: <T>() => {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  }
}

if (promiseCtor.withResolvers === undefined) {
  promiseCtor.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

export {}
