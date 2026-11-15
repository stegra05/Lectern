import { describe, expect, it } from 'vitest'
import { bandPath, fan, fitTrack, labelWidth, layoutTrack } from './track.ts'

describe('layoutTrack', () => {
  it('draws 11 lectures exactly as the canvas', () => {
    const track = layoutTrack(11)
    expect(track.perRow).toBe(4)
    expect(track.stops.map((s) => [s.x, s.y])).toEqual([
      [160, 190],
      [420, 190],
      [680, 190],
      [940, 190],
      [940, 350],
      [680, 350],
      [420, 350],
      [160, 350],
      [160, 510],
      [420, 510],
      [680, 510],
    ])
    expect(track.flag).toMatchObject({ x: 940, y: 510, row: 2, dir: 1 })
    expect(track.band).toBe('M160,190 H940 A80 80 0 0 1 940,350 H160 A80 80 0 0 0 160,510 H940')
  })

  it('rows alternate direction', () => {
    const track = layoutTrack(11)
    expect(track.stops[0]!.dir).toBe(1)
    expect(track.stops[4]!.dir).toBe(-1)
    expect(track.stops[8]!.dir).toBe(1)
  })

  it('ends the band at the flag when the last row is short', () => {
    const track = layoutTrack(5)
    expect(track.flag).toMatchObject({ x: 680, y: 350 })
    expect(track.band).toBe('M160,190 H940 A80 80 0 0 1 940,350 H680')
  })

  it('keeps one straight row for a short course', () => {
    const track = layoutTrack(2)
    expect(track.stops.map((s) => s.x)).toEqual([160, 420])
    expect(track.band).toBe('M160,190 H680')
  })

  it('uses five stops per row from 17 lectures on', () => {
    expect(layoutTrack(16).perRow).toBe(4)
    const track = layoutTrack(17)
    expect(track.perRow).toBe(5)
    expect(track.step).toBe(195)
    expect(track.stops[5]).toMatchObject({ x: 940, y: 350, dir: -1 })
    expect(track.flag).toMatchObject({ x: 550, y: 670, row: 3 })
    expect(track.band.match(/A/g)).toHaveLength(3)
  })
})

describe('fitTrack', () => {
  const window = { left: 0, top: 38, right: 1100, bottom: 652 }

  it('keeps the canvas positions at the reference window', () => {
    const fit = fitTrack(layoutTrack(11), window, 1)
    expect(fit.k).toBe(1)
    expect(fit.centre.x + fit.k * (160 - fit.origin.x)).toBe(160)
    expect(fit.centre.y + fit.k * (190 - fit.origin.y)).toBe(190)
  })

  it('zooms out and slides left of an open side panel', () => {
    const fit = fitTrack(layoutTrack(11), { ...window, right: 1100 - 356 }, 1)
    expect(fit.k).toBeCloseTo(0.7, 2)
    expect(fit.centre.x).toBe(372)
    expect(fit.centre.x + fit.k * (160 - fit.origin.x)).toBeCloseTo(100, 0)
  })

  it('fits one lecture and thirty lectures at the smallest zoom or more', () => {
    for (const n of [1, 30]) {
      const fit = fitTrack(layoutTrack(n), window, 1)
      expect(fit.k).toBeGreaterThanOrEqual(0.2)
      expect(Number.isFinite(fit.k)).toBe(true)
    }
  })

  it('never grows the track past the given cap', () => {
    expect(fitTrack(layoutTrack(3), window, 1).k).toBe(1)
  })
})

describe('fan', () => {
  it('spreads three topics by 30 degrees, 37 above the stop centre', () => {
    const dots = fan([10, 20, 10])
    expect(dots[1]!.dot).toEqual({ x: 0, y: -37 })
    expect(dots[0]!.dot.x).toBeCloseTo(-18.5, 1)
    expect(dots[0]!.from.y).toBeCloseTo(-20.8, 1)
    expect(dots[1]!.r).toBeGreaterThan(dots[0]!.r)
  })

  it('narrows the spread for four topics and has no dots without topics', () => {
    const dots = fan([5, 5, 5, 5])
    const angle = (Math.atan2(dots[3]!.dot.x, -dots[3]!.dot.y) * 180) / Math.PI
    expect(angle).toBeCloseTo(39, 0)
    expect(fan([])).toEqual([])
  })
})

describe('labels on the track', () => {
  const panel = { left: 0, top: 38, right: 1100 - 356, bottom: 652 }

  it('keep every title inside the window and clear of the panel in the fitted view', () => {
    for (const lectures of [3, 11, 16, 17, 24]) {
      const track = layoutTrack(lectures)
      const fit = fitTrack(track, panel, 1)
      const width = labelWidth(fit.k, track.step)
      for (const p of [...track.stops, track.flag]) {
        const x = fit.centre.x + fit.k * (p.x - fit.origin.x)
        expect(x - width / 2).toBeGreaterThanOrEqual(0)
        expect(x + width / 2).toBeLessThanOrEqual(panel.right)
      }
    }
  })

  it('never let two titles of a row touch', () => {
    for (const k of [0.5, 0.7, 1, 1.3]) {
      expect(labelWidth(k, 260)).toBeLessThan(k * 260)
      expect(labelWidth(k, 195)).toBeLessThan(k * 195)
    }
  })

  it('keep a one-line caption above the fan of the row below', () => {
    const track = layoutTrack(11)
    const fit = fitTrack(track, panel, 1)
    // Caption ends 59px under a stop's centre, the fan reaches 46px above the next one.
    expect(fit.k * 160).toBeGreaterThanOrEqual(59 + 46)
  })
})

describe('bandPath', () => {
  it('draws the same band through the zoom, with turns that shrink along', () => {
    const track = layoutTrack(11)
    const half = bandPath(track, (p) => ({ x: p.x / 2, y: p.y / 2 }), 0.5)
    expect(half).toBe('M80,95 H470 A40 40 0 0 1 470,175 H80 A40 40 0 0 0 80,255 H470')
  })
})
