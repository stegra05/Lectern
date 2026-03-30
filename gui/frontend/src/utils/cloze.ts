/**
 * Utility functions for rendering Anki Cloze deletion strings in the frontend.
 * Supports patterns like {{c1::answer}} and {{c2::answer::hint}}.
 */

const CLOZE_PATTERN = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
type MathRange = [number, number];

function findMathRanges(text: string): MathRange[] {
    const ranges: MathRange[] = [];
    const delimiters = [
        { open: '\\[', close: '\\]' },
        { open: '\\(', close: '\\)' },
    ] as const;

    let cursor = 0;
    while (cursor < text.length) {
        let next:
            | { index: number; open: string; close: string }
            | null = null;

        for (const delimiter of delimiters) {
            const index = text.indexOf(delimiter.open, cursor);
            if (index === -1) continue;
            if (!next || index < next.index) {
                next = { index, open: delimiter.open, close: delimiter.close };
            }
        }

        if (!next) break;
        const end = text.indexOf(next.close, next.index + next.open.length);
        if (end === -1) break;

        ranges.push([next.index, end + next.close.length]);
        cursor = end + next.close.length;
    }

    return ranges;
}

function replaceCloze(
    text: string,
    formatter: (
        num: string,
        answer: string,
        hint: string | undefined,
        context: { inMath: boolean }
    ) => string
): string {
    const mathRanges = findMathRanges(text);

    return text.replace(
        CLOZE_PATTERN,
        (match, num, answer, hint, offset) => {
            const start = Number(offset);
            const end = start + String(match).length;
            const inMath = mathRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd);
            return formatter(num, answer, hint, { inMath });
        }
    );
}

/**
 * Renders the front side of a Cloze card by replacing all deletions with [...]
 * or with their hint if provided.
 */
export function renderClozeFront(text: string): string {
    return replaceCloze(
        text,
        (_num, _answer, hint, context) =>
            context.inMath
                ? (hint || '...')
                : `<span class="cloze-placeholder">[${hint || '...'}]</span>`
    );
}

/**
 * Renders the back side of a Cloze card by highlighting the answers.
 */
export function renderClozeBack(text: string): string {
    return replaceCloze(
        text,
        (_num, answer, _hint, context) =>
            context.inMath
                ? answer
                : `<span class="cloze-answer">${answer}</span>`
    );
}

/**
 * Highlights Cloze patterns with a styled span for general UI display (e.g. lists).
 */
export function highlightCloze(html: string): string {
    return replaceCloze(
        html,
        (num, answer, hint, context) => {
            if (context.inMath) return answer;
            const label = hint ? `${answer} (${hint})` : answer;
            return `<span class="cloze-hl" data-cloze="${num}">${label}</span>`;
        }
    );
}

export function highlightClozeFocus(html: string): string {
    return replaceCloze(
        html,
        (_num, answer, _hint, context) =>
            context.inMath
                ? answer
                : `<span class="bg-primary/20 text-primary px-1.5 py-0.5 rounded font-semibold">${answer}</span>`
    );
}
