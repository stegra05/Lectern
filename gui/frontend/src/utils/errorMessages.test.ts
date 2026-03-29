import { describe, expect, it } from 'vitest';

import { translateError } from './errorMessages';

describe('translateError', () => {
    it('maps spending cap errors to billing guidance in generation context', () => {
        const out = translateError(
            'provider_generation_failed: Gemini API spending cap reached for this project',
            'generation'
        );

        expect(out.title).toBe('Billing Limit Reached');
        expect(out.message).toContain('spending cap');
        expect(out.action).toContain('Increase the spending cap');
    });

    it('prioritizes spending cap messaging over generic 5xx server mapping', () => {
        const out = translateError(
            'HTTP 500: provider_generation_failed: 429 RESOURCE_EXHAUSTED spending cap exceeded',
            'generation'
        );

        expect(out.title).toBe('Billing Limit Reached');
        expect(out.message).toContain('spending cap');
    });
});
