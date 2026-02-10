import type { Card, ProgressEvent } from '../api';
import type { SortOption } from '../hooks/types';

export function findLastError(logs: ProgressEvent[], isError: boolean): string | null {
    if (!isError) return null;
    for (let i = logs.length - 1; i >= 0; i--) {
        if (logs[i].type === 'error') return logs[i].message;
    }
    return 'Unknown error occurred';
}

export function buildSearchRegex(query: string): RegExp | null {
    if (!query.trim()) return null;

    try {
        if (query.startsWith('/') && query.length > 1) {
            const pattern = query.replace(/^\/|\/$/g, '');
            return new RegExp(pattern, 'i');
        }
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i');
    } catch {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i');
    }
}

export function filterCards(cards: Card[], query: string): Card[] {
    const regex = buildSearchRegex(query);
    if (!regex) return cards;

    return cards.filter((card) => {
        const content = [
            card.front,
            card.back,
            card.tag,
            card.model_name,
            card.slide_topic,
            ...(Object.values(card.fields || {})),
        ].join(' ');
        return regex.test(content);
    });
}

export function sortCards(cards: Card[], sortBy: SortOption): Card[] {
    const sorted = [...cards];
    switch (sortBy) {
        case 'topic':
            return sorted.sort((a, b) => (a.slide_topic || '').localeCompare(b.slide_topic || ''));
        case 'slide':
            return sorted.sort((a, b) => (a.slide_number || 0) - (b.slide_number || 0));
        case 'type':
            return sorted.sort((a, b) => (a.model_name || '').localeCompare(b.model_name || ''));
        default:
            return sorted.reverse();
    }
}
