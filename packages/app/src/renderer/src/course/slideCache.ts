/**
 * Remembers each read for this session and hands the same picture to every row that asks. A read
 * that fails or finds no picture is forgotten, so the next row to show it tries again.
 */
export function slideCache() {
  const cache = new Map<string, Promise<string | null>>()
  return (key: string, read: () => Promise<string | null>): Promise<string | null> => {
    let found = cache.get(key)
    if (!found) {
      const attempt: Promise<string | null> = read()
        .catch(() => null)
        .then((url) => {
          if (!url && cache.get(key) === attempt) cache.delete(key)
          return url
        })
      found = attempt
      cache.set(key, found)
    }
    return found
  }
}
