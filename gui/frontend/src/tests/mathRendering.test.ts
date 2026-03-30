import { describe, it, expect } from 'vitest';
import { renderMathInHtml } from '../utils/mathRendering';

describe('renderMathInHtml', () => {
    it('renders inline and display delimiters', () => {
        const input = 'Formula: \\(x=1\\) and \\[y=2\\]';
        const result = renderMathInHtml(input);

        expect(result).toContain('katex');
        expect(result).toContain('Formula:');
    });

    it('keeps non-math html untouched', () => {
        const input = '<b>Hello</b> world';
        const result = renderMathInHtml(input);

        expect(result).toContain('<b>Hello</b>');
        expect(result).toContain('world');
    });

    it('gracefully falls back to raw delimiters on parse errors', () => {
        const input = 'Broken: \\(\\frac{1}{\\) text';
        const result = renderMathInHtml(input);

        expect(result).toContain('Broken:');
        expect(result).toContain('\\(\\frac{1}{\\)');
    });
});
