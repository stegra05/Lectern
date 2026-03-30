import { describe, it, expect } from 'vitest';
import { renderClozeFront, renderClozeBack, highlightCloze, highlightClozeFocus } from '../utils/cloze';

describe('Cloze Utils', () => {
    describe('renderClozeFront', () => {
        it('replaces simple cloze with placeholders', () => {
            const input = 'This is a {{c1::test}} sentence.';
            const result = renderClozeFront(input);
            expect(result).toBe('This is a <span class="cloze-placeholder">[...]</span> sentence.');
        });

        it('replaces cloze with hint with hint placeholder', () => {
            const input = 'This is a {{c1::test::hint}} sentence.';
            const result = renderClozeFront(input);
            expect(result).toBe('This is a <span class="cloze-placeholder">[hint]</span> sentence.');
        });

        it('handles multiple clozes', () => {
            const input = '{{c1::One}} and {{c2::Two}}';
            const result = renderClozeFront(input);
            expect(result).toBe('<span class="cloze-placeholder">[...]</span> and <span class="cloze-placeholder">[...]</span>');
        });
    });

    describe('renderClozeBack', () => {
        it('highlights simple cloze answer', () => {
            const input = 'This is a {{c1::test}} sentence.';
            const result = renderClozeBack(input);
            expect(result).toBe('This is a <span class="cloze-answer">test</span> sentence.');
        });

        it('highlights cloze answer and ignores hint', () => {
            const input = 'This is a {{c1::test::hint}} sentence.';
            const result = renderClozeBack(input);
            expect(result).toBe('This is a <span class="cloze-answer">test</span> sentence.');
        });

        it('keeps plain answer when cloze is inside math delimiters', () => {
            const input = 'Formula: \\( {{c1::x^2}} + y^2 \\)';
            const result = renderClozeBack(input);
            expect(result).toBe('Formula: \\( x^2 + y^2 \\)');
        });
    });

    describe('highlightCloze', () => {
        it('creates highlighted labels for UI', () => {
            const input = '{{c1::test::hint}}';
            const result = highlightCloze(input);
            expect(result).toBe('<span class="cloze-hl" data-cloze="1">test (hint)</span>');
        });

        it('does not inject html spans for cloze inside math delimiters', () => {
            const input = '\\( {{c1::L(x)}} \\)';
            const result = highlightCloze(input);
            expect(result).toBe('\\( L(x) \\)');
        });
    });

    describe('highlightClozeFocus', () => {
        it('does not inject focus cloze span inside math delimiters', () => {
            const input = '\\( {{c1::a+b}} \\)';
            const result = highlightClozeFocus(input);
            expect(result).toBe('\\( a+b \\)');
        });
    });
});
