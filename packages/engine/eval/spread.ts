/** How far one figure moves over repeated runs of the same variant. */
export interface Spread {
  mean: number
  /** The sample standard deviation. */
  sd: number
  min: number
  max: number
}

export function spread(values: number[]): Spread {
  if (values.length < 2) throw new Error('A spread needs at least two runs.')
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squares = values.reduce((sum, v) => sum + (v - mean) ** 2, 0)
  return {
    mean,
    sd: Math.sqrt(squares / (values.length - 1)),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

/**
 * The smallest difference between two variants worth believing when each is the mean of `runs`
 * runs: twice the standard error of the difference, about 95 percent, if both spread by `sd`.
 */
export function believable(sd: number, runs: number): number {
  return 2 * sd * Math.sqrt(2 / runs)
}
