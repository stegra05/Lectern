/**
 * Calls paced to a provider's tokens a minute. A key's limit counts every input token, cached
 * ones too: a build that sent its calls as fast as it could was stopped by rate limits
 * (measured 2026-11-16 on a key of 2 million tokens a minute). So each call waits until the
 * last minute's tokens leave room for it.
 *
 * The limit comes from the provider with the first answer, so the first call goes alone. A call
 * is counted at its estimate when it starts and at what it really used once it is answered.
 */

/** The share of the limit a build plans to use; the rest absorbs estimates that were low. */
const SHARE = 0.9
const MINUTE = 60_000

export interface Pace {
  /** Runs `call` once the last minute leaves room for `estimate` tokens. */
  run<R>(
    estimate: number,
    call: () => Promise<{ reply: R; limit: number; tokens: number }>,
  ): Promise<R>
}

export function pace(
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Pace {
  let limit: number | undefined
  let first: Promise<unknown> | undefined
  const window: { at: number; tokens: number }[] = []
  const room = async (estimate: number) => {
    for (;;) {
      const t = now()
      while (window.length > 0 && window[0]!.at <= t - MINUTE) window.shift()
      const used = window.reduce((sum, entry) => sum + entry.tokens, 0)
      // A call larger than the whole budget still runs, alone.
      if (used + estimate <= limit! * SHARE || window.length === 0) {
        const entry = { at: t, tokens: estimate }
        window.push(entry)
        return entry
      }
      await sleep(window[0]!.at + MINUTE - t)
    }
  }
  return {
    async run(estimate, call) {
      if (limit === undefined) {
        if (!first) {
          const entry = { at: now(), tokens: estimate }
          window.push(entry)
          const started = call().then((answer) => {
            limit = answer.limit
            entry.tokens = answer.tokens
            return answer.reply
          })
          // A failed first call lets the next one find the limit.
          first = started.catch(() => (first = undefined))
          return started
        }
        await first
        if (limit === undefined) return this.run(estimate, call)
      }
      const entry = await room(estimate)
      const answer = await call()
      entry.tokens = answer.tokens
      return answer.reply
    },
  }
}
