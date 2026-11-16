import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const bench = join(import.meta.dirname, '../eval/bench.ts')

async function run(...args: string[]): Promise<{ out: string; code: number }> {
  const result = await promisify(execFile)('node', [bench, ...args]).catch(
    (error: { code: number; stdout: string; stderr: string }) => error,
  )
  const out = `${result.stdout}${result.stderr}`
  return { out, code: 'code' in result ? result.code : 0 }
}

const write = (path: string, value: unknown) => writeFile(path, JSON.stringify(value))

/** A rubric of two questions and a run of two cards, in a new folder. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bench-'))
  const [papers, deck] = [join(root, 'papers'), join(root, 'run')]
  await mkdir(papers)
  await mkdir(deck)
  const question = (number: string, knows: string) => ({
    number,
    asks: `Question ${number}`,
    marks: 2,
    points: [{ knows, marks: 2, kind: 'recall', basis: 'slides' }],
  })
  await write(join(papers, 'Summer 26.json'), {
    paper: 'Summer 26',
    total: 4,
    choices: [],
    questions: [
      question('1', 'The value proposition is the unique offering a firm promises.'),
      question('2', 'Effectuation starts from the available means.'),
    ],
  })
  await write(join(deck, 'cards.json'), [
    { id: 'vp', question: 'What is a value proposition?', answer: 'The unique offering.' },
    { id: 'means', question: 'What does effectuation start from?', answer: 'Available means.' },
  ])
  const rubric = join(root, 'rubric.json')
  expect((await run('rubric', 'Course', papers, rubric)).out).toContain('2 points for 4 marks')
  return { root, deck, rubric }
}

describe('the exam eval on the command line', () => {
  it('goes from a rubric over batches and verdicts to a score', async () => {
    const { root, deck, rubric } = await setup()
    expect((await run('report', rubric, deck)).out).toContain('undecided pairs')

    expect((await run('batches', rubric, deck)).out).toContain('open pairs on 2 of 2 points')
    const batch = JSON.parse(await readFile(join(deck, 'pairs/01.json'), 'utf8')) as {
      point: string
      cards: { id: string }[]
    }[]
    const verdicts = batch.flatMap(({ point, cards }) =>
      cards.map((card) => ({
        point,
        card: card.id,
        verdict: point.endsWith('/1/1') && card.id === 'vp' ? 'same' : 'no',
      })),
    )
    await write(join(deck, 'verdicts/01.json'), verdicts)

    const report = await run('report', rubric, deck)
    expect(report.code).toBe(0)
    expect(report.out).toContain('Held: 50.0% of the marks, 1 of 2 points')
    // Nothing is left to judge, and the verdicts are kept beside the rubric.
    expect((await run('batches', rubric, deck)).out).toContain('0 open pairs')
    const kept = JSON.parse(await readFile(join(root, 'verdicts.json'), 'utf8')) as object
    expect(Object.keys(kept)).toHaveLength(verdicts.length)
    const compared = await run('compare', rubric, deck, deck)
    expect(compared.out).toContain('Difference: +0.0 points of coverage')
    expect(compared.out).toContain('Too few questions for an interval')
  })

  it('stops at a verdict for a card the run lacks', async () => {
    const { deck, rubric } = await setup()
    await mkdir(join(deck, 'verdicts'))
    await write(join(deck, 'verdicts/01.json'), [
      { point: 'Summer 26/1/1', card: 'vq', verdict: 'same' },
    ])
    const report = await run('report', rubric, deck)
    expect(report.code).not.toBe(0)
    expect(report.out).toContain('the card vq, which the run lacks')
  })

  it('stops at a broken file of kept verdicts and leaves it alone', async () => {
    const { root, deck, rubric } = await setup()
    await writeFile(join(root, 'verdicts.json'), '{"abc": "sa')
    const batches = await run('batches', rubric, deck)
    expect(batches.code).not.toBe(0)
    expect(batches.out).toContain('verdicts.json cannot be read')
    expect(await readFile(join(root, 'verdicts.json'), 'utf8')).toBe('{"abc": "sa')
  })

  it('refuses a batch size that is no whole number above zero', async () => {
    const { deck, rubric } = await setup()
    for (const size of ['0', '2.5', 'abc']) {
      const batches = await run('batches', rubric, deck, '--size', size)
      expect(batches.code).not.toBe(0)
      expect(batches.out).toContain('--size is a whole number above zero')
    }
  })

  /** A judged run folder beside the rubric: its cards, what its build took, and verdicts. */
  async function judgedRun(
    root: string,
    rubric: string,
    name: string,
    held: string[],
    calls: number,
  ) {
    const deck = join(root, name)
    await mkdir(deck)
    await write(join(deck, 'cards.json'), [
      {
        id: `${name}-vp`,
        question: 'What is a value proposition?',
        answer: `The unique offering (${name}).`,
      },
      {
        id: `${name}-means`,
        question: 'What does effectuation start from?',
        answer: `Available means (${name}).`,
      },
    ])
    await write(join(deck, 'meta.json'), { effort: { calls, outputTokens: 1000 } })
    await run('batches', rubric, deck)
    const batch = JSON.parse(await readFile(join(deck, 'pairs/01.json'), 'utf8')) as {
      point: string
      cards: { id: string }[]
    }[]
    const fits = (point: string, card: string) =>
      (point.endsWith('/1/1') && card.endsWith('-vp')) ||
      (point.endsWith('/2/1') && card.endsWith('-means'))
    await write(
      join(deck, 'verdicts/01.json'),
      batch.flatMap(({ point, cards }) =>
        cards.map((card) => ({
          point,
          card: card.id,
          verdict: fits(point, card.id) && held.some((h) => card.id.endsWith(h)) ? 'same' : 'no',
        })),
      ),
    )
    return deck
  }

  it('gives one verdict on a change: better, or stopped by a guard', async () => {
    const { root, rubric } = await setup()
    const old = [
      await judgedRun(root, rubric, 'old1', ['-vp'], 100),
      await judgedRun(root, rubric, 'old2', ['-vp'], 100),
    ]
    const better = await judgedRun(root, rubric, 'new1', ['-vp', '-means'], 105)
    const gate = (next: string) =>
      run('gate', rubric, '--old', old[0]!, '--old', old[1]!, '--new', next)
    const passed = await gate(better)
    expect(passed.out).toContain('Old: 50.0% of the marks over 2 builds (50.0%, 50.0%)')
    expect(passed.out).toContain('New: 100.0% of the marks over 1 builds (100.0%)')
    expect(passed.out).toContain('holds  calls: 100 to 105, at most 110')
    expect(passed.out.trim().endsWith('Verdict: better')).toBe(true)

    const costly = await judgedRun(root, rubric, 'new2', ['-vp', '-means'], 130)
    const stopped = await gate(costly)
    expect(stopped.out).toContain('FAILS  calls: 100 to 130, at most 110')
    expect(stopped.out.trim().endsWith('Verdict: guard')).toBe(true)
  })
})
