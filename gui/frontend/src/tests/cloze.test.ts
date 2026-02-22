import { describe, it, expect } from 'vitest';
import { renderClozeFront, renderClozeBack, highlightCloze } from '../utils/cloze';

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
    });

    describe('highlightCloze', () => {
        it('creates highlighted labels for UI', () => {
            const input = '{{c1::test::hint}}';
            const result = highlightCloze(input);
            expect(result).toBe('<span class="cloze-hl" data-cloze="1">test (hint)</span>');
        });
    });
});
