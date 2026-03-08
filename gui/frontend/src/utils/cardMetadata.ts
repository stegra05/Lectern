import type { Card } from '../api';

const buildFieldsFromCanonical = (card: Card): Record<string, string> => {
    if ((card.model_name || '').toLowerCase() === 'cloze') {
        const text = String(card.text || '').trim();
        return text ? { Text: text } : {};
    }
    const front = String(card.front || '').trim();
    const back = String(card.back || '').trim();
    const result: Record<string, string> = {};
    if (front) result.Front = front;
    if (back) result.Back = back;
    return result;
};

export const getCardSlideNumber = (card: Card): number | null => {
    if (typeof card.slide_number === 'number' && Number.isInteger(card.slide_number) && card.slide_number > 0) {
        return card.slide_number;
    }
    if (Array.isArray(card.source_pages)) {
        const first = card.source_pages.find((page): page is number => Number.isInteger(page) && page > 0);
        return first ?? null;
    }
    return null;
};

export const getCardPageReferences = (card: Card): number[] => {
    if (Array.isArray(card.source_pages)) {
        const pages = card.source_pages.filter((page): page is number => Number.isInteger(page) && page > 0);
        if (pages.length > 0) {
            return [...new Set(pages)].sort((a, b) => a - b);
        }
    }
    const slideNumber = getCardSlideNumber(card);
    return slideNumber !== null ? [slideNumber] : [];
};

export const normalizeCardMetadata = (card: Card): Card => {
    return {
        ...card,
        fields: card.fields && Object.keys(card.fields).length > 0 ? card.fields : buildFieldsFromCanonical(card),
    };
};

export const normalizeCardsMetadata = (cards: Card[]): Card[] => cards.map(normalizeCardMetadata);

export const deriveMaxSlideNumber = (cards: Card[]): number => {
    let max = 0;
    for (const card of cards) {
        const slideNumber = getCardSlideNumber(card);
        if (slideNumber !== null && slideNumber > max) {
            max = slideNumber;
        }
    }
    return max;
};
