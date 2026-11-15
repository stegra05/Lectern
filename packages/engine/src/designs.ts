/**
 * The card designs that ship. A design is a stylesheet over the same four templates
 * (`design/cards/FIELDS.md`). Constants only, so an interface can import them without the
 * engine.
 */

export const DESIGNS = ['native', 'structure', 'lamp', 'colours', 'afterglow', 'vitrine'] as const
export type Design = (typeof DESIGNS)[number]
