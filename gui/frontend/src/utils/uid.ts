import type { Card } from '../api';

const requireBackendUid = (card: Card): string => {
    if (!card.uid) {
        console.warn('Missing required backend uid on card payload, using fallback', card);
        return `fallback-${Math.random().toString(36).substring(2, 11)}`;
    }
    return card.uid;
};

/**
 * Stamp a stable `_uid` onto a card (no-op if already present).
 * Assumes backend-provided `uid` is present.
 */
export const stampUid = (card: Card): Card =>
    card._uid ? card : { ...card, _uid: requireBackendUid(card) };

/** Stamp UIDs on an array of cards. */
export const stampUids = (cards: Card[]): Card[] => cards.map(stampUid);

/**
 * Reconcile incoming cards with existing cards: preserve _uid for cards that match by content.
 *
 * Used ONLY for `cards_replaced` events (reflection) where the full deck is swapped.
 * For individual `card` events the data plane appends directly — no reconciliation.
 */
export function reconcileCardUids(existingCards: Card[], incomingCards: Card[]): Card[] {
    const uidToClientUid = new Map<string, string>();
    for (const c of existingCards) {
        if (c._uid) {
            if (c.uid) uidToClientUid.set(c.uid, c._uid);
        }
    }
    return incomingCards.map((card) => {
        if (card.uid) {
            const preserved = uidToClientUid.get(card.uid);
            if (preserved) return { ...card, _uid: preserved };
            return { ...card, _uid: card.uid };
        }
        return { ...card, _uid: requireBackendUid(card) };
    });
}
