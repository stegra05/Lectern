import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const blind = join(import.meta.dirname, '../eval/blind.ts')

async function run(...args: string[]): Promise<{ out: string; code: number }> {
  const result = await promisify(execFile)('node', [blind, ...args]).catch(
    (error: { code: number; stdout: string; stderr: string }) => error,
  )
  return { out: `${result.stdout}${result.stderr}`, code: 'code' in result ? result.code : 0 }
}

const write = (path: string, value: unknown) => writeFile(path, JSON.stringify(value))

/** Three concepts in lecture 1, one in lecture 2 and one in lecture 3, plus a note with no match. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'blind-'))
  const folder = join(root, 'eval')
  await mkdir(join(folder, 'labels'), { recursive: true })
  const concepts = ['01-risk', '01-uncertainty', '01-insurance', '02-bird-in-hand', '03-loop']
  await write(
    join(folder, 'cards.json'),
    concepts.flatMap((concept) => [
      { id: `${concept}-definition-1`, question: `Lectern ${concept}?`, answer: 'L answer' },
      { id: `${concept}-cloze-list-1`, question: `Lectern ${concept} [...]`, answer: 'L gap' },
    ]),
  )
  await write(
    join(folder, 'reference.json'),
    [...concepts, 'none'].map((concept, i) => ({
      id: i + 1,
      deck: 'Deck',
      question: `Reference ${concept}?`,
      answer: 'R answer',
      source: 'Lecture 1',
      asked: null,
    })),
  )
  await write(join(folder, 'labels/01.json'), [
    ...concepts.map((concept, i) => ({
      id: i + 1,
      match: i % 2 ? 'partial' : 'same',
      card: `${concept}-definition-1`,
      stated: null,
    })),
    { id: 6, match: 'none', card: null, stated: 'absent' },
  ])
  return { root, folder }
}

const keyOf = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as {
    seed: number
    pairs: { pair: number; concept: string; lectern: 'A' | 'B' }[]
  }

describe('the blind sample', () => {
  it('draws one pair per concept, spread over the lectures, and repeats with a seed', async () => {
    const { root, folder } = await setup()
    const [sample, key] = [join(root, 'sample.txt'), join(root, 'key.json')]
    const drawn = await run('draw', folder, sample, key, '--size', '3', '--seed', '7')
    expect(drawn.out).toContain('3 pairs drawn from 5 concepts matched in both decks, seed 7')

    const { pairs, seed } = await keyOf(key)
    expect(seed).toBe(7)
    // Three lectures, three pairs: one concept from each.
    expect(pairs.map((p) => p.concept.slice(0, 2)).sort()).toEqual(['01', '02', '03'])

    const text = await readFile(sample, 'utf8')
    expect(text).toContain('Pair 3')
    expect(text).toContain('Lectern is:')
    // Nothing in the sample says where a card comes from.
    expect(text).not.toMatch(/Lecture 1|Deck|definition|cloze-list|none/)
    const first = pairs[0]!
    const [a, b] = text.split(/^Pair 1$/m)[1]!.split(/^B$/m)
    expect(a).toContain(first.lectern === 'A' ? 'Lectern' : 'Reference')
    expect(b).toContain(first.lectern === 'A' ? 'Reference' : 'Lectern')

    const again = join(root, 'key2.json')
    await run('draw', folder, join(root, 'sample2.txt'), again, '--size', '3', '--seed', '7')
    expect(await readFile(again, 'utf8')).toBe(await readFile(key, 'utf8'))
  })

  it('draws fewer pairs than asked when fewer concepts match', async () => {
    const { root, folder } = await setup()
    const drawn = await run('draw', folder, join(root, 's.txt'), join(root, 'k.json'))
    expect(drawn.out).toContain('5 pairs drawn from 5 concepts')
  })

  it('scores answers against the key', async () => {
    const { root, folder } = await setup()
    const [sample, key] = [join(root, 'sample.txt'), join(root, 'key.json')]
    await run('draw', folder, sample, key, '--size', '4', '--seed', '1')
    const { pairs } = await keyOf(key)
    const other = (side: 'A' | 'B') => (side === 'A' ? 'B' : 'A')
    // Pair 1: told apart, Lectern preferred. Pair 2: told apart wrongly, reference preferred.
    // Pair 3: cannot tell, no preference. Pair 4: left blank.
    const answers = [
      [pairs[0]!.lectern, pairs[0]!.lectern],
      [other(pairs[1]!.lectern), pairs[1]!.lectern === 'A' ? 'B' : 'A'],
      ['?', '='],
      ['', ''],
    ]
    const text = (await readFile(sample, 'utf8'))
      .split(/^(?=Pair \d+$)/m)
      .map((block, i) =>
        i === 0
          ? block
          : block
              .replace(/^Lectern is:.*$/m, `Lectern is: ${answers[i - 1]![0]}`)
              .replace(/^Prefer:.*$/m, `Prefer: ${answers[i - 1]![1]!.toLowerCase()}`),
      )
      .join('')
    await writeFile(sample, text)
    const scored = await run('score', sample, key)
    expect(scored.code).toBe(0)
    expect(scored.out).toContain('Pairs answered: 3 of 4')
    expect(scored.out).toContain('Told apart: 1 of 3 (33%)')
    expect(scored.out).toContain("Lectern's preferred: 1 of 3 (33%)")
    expect(scored.out).toContain('Reference preferred: 1 of 3 (33%)')
    expect(scored.out).toContain('No preference: 1 of 3 (33%)')
  })

  it('refuses an answer that is no side, and a pair the key lacks', async () => {
    const { root, folder } = await setup()
    const [sample, key] = [join(root, 'sample.txt'), join(root, 'key.json')]
    await run('draw', folder, sample, key, '--size', '1', '--seed', '1')
    await writeFile(sample, 'Pair 1\n\nLectern is: C\nPrefer: A\n')
    expect((await run('score', sample, key)).out).toContain('takes A, B or ?')
    await writeFile(sample, 'Pair 9\n\nLectern is: A\nPrefer: A\n')
    expect((await run('score', sample, key)).out).toContain('Pair 9 is not in the key')
    expect((await run('draw', folder, sample, key, '--size', '0')).out).toContain('--size')
  })
})
