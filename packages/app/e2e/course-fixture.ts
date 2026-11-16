import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makePdf } from './pdf.ts'

/** A lecture of `topics` topics with `concepts` concepts each, two cards per concept. */
export function lecture(number: number, title: string, topics: number, concepts: number) {
  const tree = Array.from({ length: topics }, (_, t) => ({
    name: `Topic ${t + 1}`,
    concepts: Array.from({ length: concepts }, (_, c) => ({
      id: `l${number}-t${t}-c${c}`,
      name: `Concept ${t + 1}.${c + 1}`,
      slides: [2],
      facts: [],
    })),
  }))
  const cards = tree.flatMap((topic) =>
    topic.concepts.flatMap((concept) =>
      [1, 2].map((n) => ({
        id: `${concept.id}-${n}`,
        note: 'qa',
        concept: concept.id,
        slide: 2,
        fields: {
          Front: `What is ${concept.name}?`,
          Back: `${concept.name} is a thing worth knowing.`,
          Role: 'definition',
          Lecture: String(number).padStart(2, '0'),
          Source: `Lecture ${number}, slide 2`,
          Key: concept.name,
        },
      })),
    ),
  )
  return { number, title, tree, cards }
}

/**
 * Writes a course folder called Maps that holds the given lectures, straight into a new
 * folder of courses, and returns that folder.
 */
export async function writeCourse(lectures: ReturnType<typeof lecture>[]): Promise<string> {
  const courses = await mkdtemp(join(tmpdir(), 'lectern-map-'))
  const pdf = await makePdf([['Lecture'], ['Slide']])
  const folder = join(courses, 'Maps')
  await mkdir(join(folder, 'slides'), { recursive: true })
  const files = lectures.map((l) => `${String(l.number).padStart(2, '0')}_${l.title}.pdf`)
  await writeFile(
    join(folder, 'course.json'),
    JSON.stringify({
      format: 1,
      name: 'Maps',
      goal: 'good',
      lectures: lectures.map((l, i) => ({
        number: l.number,
        title: l.title,
        file: files[i],
        sha256: createHash('sha256').update(pdf).digest('hex'),
        slides: 2,
      })),
    }),
  )
  for (const [i, l] of lectures.entries()) {
    await writeFile(join(folder, 'slides', files[i]!), pdf)
    const dir = join(folder, 'lectures', String(l.number).padStart(2, '0'))
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'lecture.json'),
      JSON.stringify({
        number: l.number,
        title: l.title,
        file: files[i],
        slides: 2,
        topics: l.tree,
        leftOut: [],
        dropped: [],
      }),
    )
    await writeFile(join(dir, 'cards.yaml'), JSON.stringify(l.cards))
  }

  return courses
}
