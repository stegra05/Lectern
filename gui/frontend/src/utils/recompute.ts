import type { Estimation } from '../api';

// NOTE(Heuristic): These mirror the backend constants in config.py.
// They are heuristics for instant client-side cost recompute — not exact.
const PROMPT_OVERHEAD = 3000;
const BASE_OUTPUT_RATIO = 0.20;
const TOKENS_PER_CARD = 100;

// Gemini pricing per million tokens: [input, output]
const PRICING: Record<string, [number, number]> = {
    'gemini-3-pro': [2.00, 12.00],
    'gemini-3-flash': [0.50, 3.00],
    'gemini-2.5-pro': [1.25, 10.00],
    'gemini-2.5-flash': [0.30, 2.50],
    default: [0.50, 4.00],
};

export interface EstimationBase {
    tokenCount: number;
    pages: number;
    textChars: number;
    imageCount: number;
    model: string;
    suggestedCardCount: number;
}

/** Extract cacheable base data from an initial estimation response. */
export const extractBase = (est: Estimation): EstimationBase => ({
    tokenCount: est.tokens,
    pages: est.pages,
    textChars: est.text_chars ?? 0,
    imageCount: est.image_count ?? 0,
    model: est.model,
    suggestedCardCount: est.suggested_card_count ?? 1,
});

/** Instant cost recompute from cached base data + new card target. */
export const recomputeCost = (base: EstimationBase, targetCards: number): Estimation => {
    const inputTokens = base.tokenCount + PROMPT_OVERHEAD;
    const baseOutput = Math.round(inputTokens * BASE_OUTPUT_RATIO);
    const cardOutput = targetCards * TOKENS_PER_CARD;
    const outputTokens = baseOutput + cardOutput;

    // Pricing lookup — match first substring in model name
    let pricing = PRICING.default;
    const modelLower = base.model.toLowerCase();
    for (const [pattern, rates] of Object.entries(PRICING)) {
        if (pattern !== 'default' && modelLower.includes(pattern)) {
            pricing = rates;
            break;
        }
    }

    const inputCost = (inputTokens / 1_000_000) * pricing[0];
    const outputCost = (outputTokens / 1_000_000) * pricing[1];

    return {
        tokens: base.tokenCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        input_cost: inputCost,
        output_cost: outputCost,
        cost: inputCost + outputCost,
        pages: base.pages,
        text_chars: base.textChars,
        model: base.model,
        estimated_card_count: targetCards,
        suggested_card_count: base.suggestedCardCount,
        image_count: base.imageCount,
    };
};
