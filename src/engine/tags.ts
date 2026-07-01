/**
 * Hierarchical Anki tag building — faithful port of
 * LecternApp/lectern/utils/tags.py (_clean_tag_part, build_hierarchical_tag,
 * build_hierarchical_tags) and note_export.build_card_tags (default tag).
 *
 * Tag format: Deck::Slide-Set::Topic — the template comes from Settings
 * (e.g. "{{deck}}::{{slide_set}}::{{topic}}").
 *
 * All functions are pure.
 */

export interface TagParts {
  deck: string
  slideSet: string
  topic?: string
}

/** Python str.isupper(): at least one cased char, none lowercase. After
 *  cleaning, parts are ASCII-only, so [A-Za-z] covers the cased chars. */
const isUpperWord = (word: string): boolean =>
  /[A-Z]/.test(word) && !/[a-z]/.test(word)

/** Python str.capitalize(): first char upper, the rest lowered. */
const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

/**
 * _clean_tag_part: normalize a string for use inside an Anki hierarchical tag.
 * Disallowed character runs become "-", multiple dashes/spaces collapse, and
 * spaces end up as "-" (Anki tags cannot contain spaces).
 */
export function cleanTagPart(
  value: string,
  options: { titleCase?: boolean; slug?: boolean } = {},
): string {
  if (!value) return ''

  // Keep letters, digits, underscore, hyphen, spaces; runs of anything else → "-".
  let s = value.replace(/[^a-zA-Z0-9_\-\s]+/g, '-')
  // Python .strip("- "): trim '-' and ' ' from both ends.
  s = s.replace(/^[- ]+/, '').replace(/[- ]+$/, '')
  // Collapse runs of 2+ dashes/whitespace into a single space
  // (a lone "-" inside a word survives, matching Python).
  s = s.replace(/[-\s]{2,}/g, ' ')

  if (options.slug) {
    s = s.toLowerCase()
  } else if (options.titleCase) {
    s = s
      .split(' ')
      .map((word) =>
        isUpperWord(word) || /^\d+$/.test(word) ? word : capitalize(word),
      )
      .join(' ')
  }

  return s.replace(/ /g, '-')
}

/**
 * build_hierarchical_tag: render the tag template with cleaned parts.
 * Deck may itself be a "::" hierarchy (each segment cleaned separately);
 * slide set and topic are Title Cased. Empty placeholders collapse — no
 * ":::"/"::::" runs and no leading/trailing ":".
 */
export function buildHierarchicalTag(template: string, parts: TagParts): string {
  const cleanedDeck = parts.deck
    ? parts.deck
        .split('::')
        .filter((segment) => segment.trim() !== '')
        .map((segment) => cleanTagPart(segment))
        .join('::')
    : ''
  const cleanedSlideSet = parts.slideSet
    ? cleanTagPart(parts.slideSet, { titleCase: true })
    : ''
  const cleanedTopic = parts.topic
    ? cleanTagPart(parts.topic, { titleCase: true })
    : ''

  let tag = template
    .replace(/\{\{deck\}\}/g, cleanedDeck)
    .replace(/\{\{slide_set\}\}/g, cleanedSlideSet)
    .replace(/\{\{topic\}\}/g, cleanedTopic)

  // Clean up empty separators left by missing placeholders.
  tag = tag.replace(/:{3,}/g, '::')
  tag = tag.replace(/^:+/, '').replace(/:+$/, '')

  return tag
}

/**
 * note_export.build_card_tags + build_hierarchical_tags: one hierarchical
 * tag (when non-empty) plus the flat default tag when enabled, deduped.
 */
export function buildCardTags(opts: {
  template: string
  deck: string
  slideSet: string
  topic?: string
  defaultTag: string
  enableDefaultTag: boolean
}): string[] {
  const result: string[] = []

  const primary = buildHierarchicalTag(opts.template, {
    deck: opts.deck,
    slideSet: opts.slideSet,
    topic: opts.topic,
  })
  if (primary) result.push(primary)

  if (opts.enableDefaultTag && opts.defaultTag) {
    const flat = opts.defaultTag.trim()
    if (flat && !result.includes(flat)) result.push(flat)
  }

  return result
}
