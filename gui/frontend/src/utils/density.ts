import type { Estimation } from '../api';

type SourceType = 'auto' | 'slides' | 'script';

export type TargetSliderConfig = {
    min: number;
    max: number;
    disabled: boolean;
};

export function computeTargetSliderConfig(suggestedCardCount?: number): TargetSliderConfig {
    if (suggestedCardCount === undefined || suggestedCardCount <= 0) {
        return { min: 1, max: 1, disabled: true };
    }
    return {
        min: Math.max(1, Math.floor(suggestedCardCount * 0.5)),
        max: Math.max(2, Math.ceil(suggestedCardCount * 1.5)),
        disabled: false,
    };
}

export function computeCardsPerUnit(
    targetDeckSize: number,
    sourceType: SourceType,
    estimation: Estimation | null
): { label: string; value: string } {
    if (!estimation) {
        return {
            label: sourceType === 'script' ? 'Cards per 1k chars' : 'Cards per slide',
            value: '0.0',
        };
    }

    if (sourceType === 'script') {
        const textChars = estimation.text_chars ?? 0;
        const scriptBasis = Math.max(textChars / 1000, 0.000001);
        return {
            label: 'Cards per 1k chars',
            value: (targetDeckSize / scriptBasis).toFixed(1),
        };
    }

    const slidesBasis = Math.max(estimation.pages, 1);
    return {
        label: 'Cards per slide',
        value: (targetDeckSize / slidesBasis).toFixed(1),
    };
}
