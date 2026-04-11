import katex from 'katex';

type Delimiter = {
    left: string;
    right: string;
    displayMode: boolean;
};

const DELIMITERS: readonly Delimiter[] = [
    { left: '\\[', right: '\\]', displayMode: true },
    { left: '\\(', right: '\\)', displayMode: false },
];

function findNextDelimiter(input: string, fromIndex: number): (Delimiter & { index: number }) | null {
    let best: (Delimiter & { index: number }) | null = null;

    for (const delimiter of DELIMITERS) {
        const index = input.indexOf(delimiter.left, fromIndex);
        if (index === -1) continue;
        if (!best || index < best.index) {
            best = { ...delimiter, index };
        }
    }

    return best;
}

export function renderMathInHtml(input: string): string {
    if (!input) return '';

    const output: string[] = [];
    let cursor = 0;

    while (cursor < input.length) {
        const next = findNextDelimiter(input, cursor);
        if (!next) {
            output.push(input.slice(cursor));
            break;
        }

        output.push(input.slice(cursor, next.index));
        const expressionStart = next.index + next.left.length;
        const expressionEnd = input.indexOf(next.right, expressionStart);

        if (expressionEnd === -1) {
            output.push(input.slice(next.index));
            break;
        }

        const expression = input.slice(expressionStart, expressionEnd);
        const wrapped = `${next.left}${expression}${next.right}`;

        try {
            output.push(katex.renderToString(expression, {
                displayMode: next.displayMode,
                throwOnError: true,
                strict: 'warn',
                output: 'htmlAndMathml',
                trust: false,
            }));
        } catch {
            output.push(wrapped);
        }

        cursor = expressionEnd + next.right.length;
    }

    return output.join('');
}
