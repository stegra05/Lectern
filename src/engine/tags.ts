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

/** At least one cased letter, none lowercase — "NLP", "SVM", "ReLU" is not. */
const isUpperWord = (word: string): boolean => /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word)

/** Title Case only words that are entirely lowercase. Anything the author
 *  already cased — ReLU, kNN, McCulloch, pH — is left exactly as written;
 *  lowercasing their tails turned real terms into misspellings. */
const capitalize = (word: string): string =>
  /\p{Lu}/u.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)

/**
 * _clean_tag_part: normalize a string for use inside an Anki hierarchical tag.
 * Disallowed character runs become "-", multiple dashes/spaces collapse, and
 * spaces end up as "-" (Anki tags cannot contain spaces).
 *
 * "Disallowed" is narrow on purpose: Anki tags are Unicode text, so letters
 * and digits of every script are kept. An ASCII-only filter turned
 * "Künstliche Intelligenz" into "K-nstliche-Intelligenz" and a CJK topic into
 * nothing at all, which silently collapsed a whole level of the hierarchy.
 */
export function cleanTagPart(
  value: string,
  options: { titleCase?: boolean; slug?: boolean } = {},
): string {
  if (!value) return ''

  // Keep letters, digits, underscore, hyphen, spaces; runs of anything else → "-".
  let s = value.replace(/[^\p{L}\p{N}_\-\s]+/gu, '-')
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
      .map((word) => (isUpperWord(word) || /^\p{N}+$/u.test(word) ? word : capitalize(word)))
      .join(' ')
  }

  return s.replace(/ /g, '-')
}

/** The placeholders a tag template may use. Anything else is a typo the
 *  Settings sheet warns about — the template is emitted literally, so
 *  "{{lecture}}" would end up in the tag verbatim. */
export const TAG_PLACEHOLDERS = ['deck', 'slide_set', 'topic'] as const

/** Placeholder names in `template` that are not real ones, for the UI. */
export function unknownTagPlaceholders(template: string): string[] {
  const found = template.match(/\{\{([^}]*)\}\}/g) ?? []
  const known = new Set<string>(TAG_PLACEHOLDERS)
  const unknown = found.map((token) => token.slice(2, -2).trim()).filter((name) => !known.has(name))
  return [...new Set(unknown)]
}

/**
 * Anki stores tags as a whitespace-separated list, so a tag that contains a
 * space is silently two tags. The parts are already space-free; this guards
 * the literal text around them, which the template author controls
 * ("Lecture {{topic}}" used to split every note's tag in half).
 */
const sanitizeRenderedTag = (tag: string): string =>
  tag.replace(/"/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-')

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
  const cleanedSlideSet = parts.slideSet ? cleanTagPart(parts.slideSet, { titleCase: true }) : ''
  const cleanedTopic = parts.topic ? cleanTagPart(parts.topic, { titleCase: true }) : ''

  let tag = template
    .replace(/\{\{deck\}\}/g, cleanedDeck)
    .replace(/\{\{slide_set\}\}/g, cleanedSlideSet)
    .replace(/\{\{topic\}\}/g, cleanedTopic)

  // Clean up empty separators left by missing placeholders.
  tag = tag.replace(/:{3,}/g, '::')
  tag = tag.replace(/^:+/, '').replace(/:+$/, '')

  return sanitizeRenderedTag(tag).replace(/^-+/, '').replace(/-+$/, '')
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
