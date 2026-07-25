import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, MODEL_CHOICES } from '../engine/config'
import { migrateModel } from './settings'

describe('migrateModel', () => {
  it('carries a retired model id forward to its replacement', () => {
    expect(migrateModel('gemini-3.5-flash')).toBe('gemini-3.6-flash')
    expect(migrateModel('gemini-3-flash')).toBe('gemini-3.6-flash')
    expect(migrateModel('gemini-3-pro')).toBe('gemini-3.1-pro-preview')
  })

  it('leaves a model the picker still offers alone', () => {
    for (const choice of MODEL_CHOICES) {
      expect(migrateModel(choice.id)).toBe(choice.id)
    }
  })

  it('falls back to the default for an unknown or missing id', () => {
    // Otherwise a stale value the UI cannot show would be sent to the API.
    expect(migrateModel('gemini-2.5-flash')).toBe(DEFAULT_MODEL)
    expect(migrateModel(undefined)).toBe(DEFAULT_MODEL)
  })

  it('resolves every migration target to an offered model', () => {
    for (const choice of MODEL_CHOICES) {
      expect(MODEL_CHOICES.some((m) => m.id === migrateModel(choice.id))).toBe(true)
    }
  })
})
