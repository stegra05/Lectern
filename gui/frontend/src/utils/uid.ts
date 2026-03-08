import type { Card } from '../api';

/** Stamp a stable `_uid` onto a card (no-op if already present). */
export const stampUid = (card: Card): Card =>
    card._uid ? card : { ...card, _uid: crypto.randomUUID() };

/** Stamp UIDs on an array of cards. */
export const stampUids = (cards: Card[]): Card[] => cards.map(stampUid);

/**
 * Deterministic content key for matching cards across snapshots.
 * Mirrors backend get_card_key logic so we can preserve _uid when reconciling.
 */
export function getCardContentKey(card: Card): string {
    const fields = card.fields && typeof card.fields === 'object' ? card.fields : {};
    const val = String(
        card.text ?? card.front ?? (fields as Record<string, string>).Text ?? (fields as Record<string, string>).Front ?? ''
    ).trim();
    return val.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Reconcile incoming cards with existing cards: preserve _uid for cards that match by content.
 * Use when replacing the full deck (cards_replaced, loadSession, recoverSessionOnRefresh, sync refresh).
 */
export function reconcileCardUids(existingCards: Card[], incomingCards: Card[]): Card[] {
    const keyToUid = new Map<string, string>();
    for (const c of existingCards) {
        if (c._uid) {
            const k = getCardContentKey(c);
            if (k && !keyToUid.has(k)) keyToUid.set(k, c._uid);
        }
    }
    return incomingCards.map((card) => {
        const k = getCardContentKey(card);
        const preservedUid = k ? keyToUid.get(k) : undefined;
        if (preservedUid) {
            keyToUid.delete(k); // Avoid reusing same uid for multiple cards
            return { ...card, _uid: preservedUid };
        }
        return stampUid(card);
    });
}
