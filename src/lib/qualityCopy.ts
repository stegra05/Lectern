import type { RejectionReason } from '../engine/types'

/** What each gate finding means, said the way a student would say it. */
const REASON_LABEL: Record<RejectionReason, string> = {
  missing_prompt_text: 'the question is empty',
  missing_answer_text: 'the answer is empty',
  missing_source_pages: 'no page cited',
  missing_rationale: 'no reason given for the card',
  missing_source_excerpt: 'no quote from the lecture',
  page_out_of_range: 'cites a page the PDF does not have',
  cloze_without_deletion: 'a cloze with nothing to fill in',
  cloze_markup_in_basic: 'cloze brackets on a basic card',
  cloze_unterminated: 'a cloze that is never closed',
  too_many_cloze_deletions: 'too many blanks in one cloze',
  markdown_not_html: 'formatting Anki would show as raw symbols',
  dollar_math_delimiters: 'math Anki would show with raw $ signs',
  answer_repeats_prompt: 'the answer repeats the question',
  outside_source: 'not from the lecture',
  missing_concept_ids: 'not linked to a concept',
  long_front: 'a long question',
  long_answer: 'a long answer',
  broad_grounding: 'cites many pages at once',
  yes_no_question: 'a yes/no question',
  points_at_source: 'points at a slide the card will not show',
  excerpt_repeats_answer: 'the quote is just the answer again',
  excerpt_not_on_cited_page: 'the quote is not on the cited page',
  invalid_structure: 'Gemini sent it in a shape Lectern could not read',
  budget_exhausted: 'the deck was already full',
}

/** "the answer is empty, no page cited" */
export const describeReasons = (reasons: RejectionReason[]): string =>
  reasons.map((reason) => REASON_LABEL[reason]).join(', ')
