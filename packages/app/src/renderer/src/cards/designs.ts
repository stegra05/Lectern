/**
 * The six card designs that ship. Each one is a stylesheet over the same four templates, read
 * from design/v3/cards/anki/ as Anki receives it.
 */

import type { Design } from '../../../shared/contract.ts'
import colours from '../../../../../../design/v3/cards/anki/style-colours.css?raw'
import lamp from '../../../../../../design/v3/cards/anki/style-lamp.css?raw'
import native from '../../../../../../design/v3/cards/anki/style-native.css?raw'
import afterglow from '../../../../../../design/v3/cards/anki/style-night.css?raw'
import vitrine from '../../../../../../design/v3/cards/anki/style-object.css?raw'
import structure from '../../../../../../design/v3/cards/anki/style-structure.css?raw'
import lampMono from '../../../../../../design/v3/cards/anki/_LampMono.woff2?url'
import lampSerif from '../../../../../../design/v3/cards/anki/_LampSerif.woff2?url'
import structureSans from '../../../../../../design/v3/cards/anki/_StructureSans.woff2?url'
import structureSerif from '../../../../../../design/v3/cards/anki/_StructureSerif.woff2?url'

export interface CardDesign {
  id: Design
  name: string
  /** One line on what the design is. */
  line: string
  css: string
}

// In Anki the fonts sit in collection.media next to the card. Here they are the app's own files.
const FONTS: Record<string, string> = {
  '_LampMono.woff2': lampMono,
  '_LampSerif.woff2': lampSerif,
  '_StructureSans.woff2': structureSans,
  '_StructureSerif.woff2': structureSerif,
}

function withFonts(css: string): string {
  return css.replace(/url\("(_[A-Za-z]+\.woff2)"\)/g, (whole, file: string) =>
    FONTS[file] ? `url("${FONTS[file]}")` : whole,
  )
}

export const CARD_DESIGNS: readonly CardDesign[] = [
  {
    id: 'native',
    name: 'Native',
    line: 'A quiet system look: grouped rows, and a blue checkmark marks the answer.',
    css: native,
  },
  {
    id: 'structure',
    name: 'Structure',
    line: 'Dashed answer slots on dot grid paper, in the colours of a survey sheet.',
    css: withFonts(structure),
  },
  {
    id: 'lamp',
    name: 'Lamp',
    line: 'An index card under a desk lamp: blank ruled lines, the answer written on them.',
    css: withFonts(lamp),
  },
  {
    id: 'colours',
    name: 'Lecture colours',
    line: 'Each card wears its lecture’s colour from the track, softened for daily review.',
    css: colours,
  },
  {
    id: 'afterglow',
    name: 'Afterglow',
    line: 'Made for reviewing in the dark: the answer is the only light on the card.',
    css: withFonts(afterglow),
  },
  {
    id: 'vitrine',
    name: 'Vitrine',
    line: 'A museum wall label: the answer is the exhibit, set in its case.',
    css: vitrine,
  },
]
