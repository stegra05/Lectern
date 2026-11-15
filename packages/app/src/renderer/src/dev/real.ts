/**
 * The real entrepreneurship course of `eval-results/v3-courses`, for design work on dense
 * lectures: every title, slide and card count, and the topics and concepts of lectures 01 and
 * 02 with the cards of each concept. Copied from their lecture.json and cards.yaml.
 */

export const REAL_TITLES = [
  'Entrepreneurship in a Digital',
  'Who are these entrepreneurs?',
  'How do entrepreneurs think?',
  'How can I come up with a good',
  'Evolve an idea into opportunity',
  'Making a Business Venture',
  'Impact entrepreneurship',
  'Finance and grow a venture',
  'How can I organize my venture?',
  'Digital entrepreneurship',
  'How do I end the venture?',
]
export const REAL_SLIDES = [55, 16, 16, 96, 23, 23, 19, 30, 24, 35, 19]
export const REAL_CARDS = [110, 35, 36, 101, 37, 52, 26, 67, 58, 82, 54]
/** Topics of lectures 01 and 02: each concept as its name and number of cards. */
export const REAL_TOPICS: Record<number, [string, [string, number][]][]> = {
  1: [
    [
      'Course introduction and mechanics',
      [
        ['Course start', 1],
        ['The TUM Advantage', 1],
        ['TUM Entrepreneurship Research Institute', 1],
        ['Course outline', 3],
        ['Course expectations', 3],
        ['Textbook', 3],
        ['Written exam', 4],
        ['Mid-term assignments', 4],
        ['Class interaction', 3],
        ['Getting in touch', 3],
        ['Inputs from practice', 3],
        ['Teaching cases', 3],
        ['Questions', 1],
        ['Starting or joining a firm', 1],
        ['Entrepreneurship and its importance', 1],
      ],
    ],
    [
      'Entrepreneurship: definitions and forms',
      [
        ['Who is an entrepreneur?', 2],
        ['Definition of entrepreneurship', 3],
        ['Special forms of entrepreneurship', 3],
        ['Degrees of unicorn founders', 2],
        ['Founder age', 1],
        ['Interpreting averages', 1],
      ],
    ],
    [
      'Entrepreneurship outcomes',
      [
        ['Outcomes', 1],
        ['Most entrepreneurs fail', 3],
        ['Failure is preventable', 3],
        ['Start-up employee earnings', 6],
      ],
    ],
    [
      'The entrepreneur',
      [
        ['The entrepreneur', 1],
        ['Entrepreneurs and personal traits', 4],
        ['Independent entrepreneurs and training', 3],
        ['Entrepreneurs as lone wolves', 3],
        ['Ex-IBMers’ firm', 1],
        ['Entrepreneurs and happiness', 1],
        ['Entrepreneurs and money', 1],
        ['Types of entrepreneurial ventures', 4],
      ],
    ],
    [
      'Entrepreneurship surroundings',
      [
        ['Surroundings', 1],
        ['Start-up funding', 1],
        ['Business degrees', 2],
        ['Investor bias', 2],
        ['Germany and entrepreneurship', 2],
        ['Entrepreneurial location', 3],
      ],
    ],
    ['Wrap-up', [['Entrepreneurship as a process', 4]]],
    [
      'Backup: entrepreneurial psychology',
      [
        ['Entrepreneurial psychology', 1],
        ['Big Five meta-analysis', 1],
        ['Personality traits', 3],
        ['The Big Five', 1],
        ['Openness to experience', 1],
        ['Conscientiousness', 1],
        ['Extraversion', 1],
        ['Agreeableness', 1],
        ['Neuroticism', 1],
        ['Big Five tendencies', 2],
        ['Motives', 4],
      ],
    ],
  ],
  2: [
    [
      'Session context',
      [
        ['Previous session topics', 1],
        ['Alex Krapp case', 1],
      ],
    ],
    [
      'Entrepreneurial intentions',
      [
        ['Entrepreneurial intentions', 2],
        ['Entrepreneurial self-efficacy', 2],
        ['Perceived desirability', 1],
      ],
    ],
    [
      'Richard Branson case',
      [
        ['Mini case: Richard Branson', 6],
        ['Some of Branson’s ventures', 1],
      ],
    ],
    [
      'Entrepreneurial traits and passion',
      [
        ['Entrepreneurs and personal traits', 1],
        ['Entrepreneurial passion', 2],
      ],
    ],
    [
      'Support networks',
      [
        ['Role models', 4],
        ['Moral support network', 3],
        ['Professional support network', 2],
      ],
    ],
    [
      'Education and work experience',
      [
        ['Education and entrepreneurial intentions', 3],
        ['Ex-IBMers’ firm', 1],
        ['Work experience and entrepreneurial intentions', 4],
      ],
    ],
    ['Wrap-up', [['Entrepreneurial intentions recap', 1]]],
  ],
}
