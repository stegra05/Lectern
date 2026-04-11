import { bench, describe } from 'vitest';
import { renderMathInHtml } from '../utils/mathRendering';

describe('renderMathInHtml', () => {
    const input = 'This is some text with inline math \\(x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\) and some more text. Here is display math: \\[ E = mc^2 \\] and that is it. '.repeat(100);

    bench('renderMathInHtml', () => {
        renderMathInHtml(input);
    });
});
