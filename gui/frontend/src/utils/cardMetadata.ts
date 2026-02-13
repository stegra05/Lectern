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
    return typeof card.slide_number === 'number' && Number.isInteger(card.slide_number) && card.slide_number > 0
        ? card.slide_number
        : null;
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
