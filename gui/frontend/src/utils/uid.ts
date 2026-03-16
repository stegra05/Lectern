import type { Card } from '../api';

/**
 * Stamp a stable `_uid` onto a card (no-op if already present).
 * NOTE: Prefer backend `uid` field when available. This is for legacy compat
 * and for cards that arrive through loadSession without a backend uid.
 */
export const stampUid = (card: Card): Card =>
    card._uid ? card : { ...card, _uid: card.uid ?? crypto.randomUUID() };

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
 *
 * Used ONLY for `cards_replaced` events (reflection) where the full deck is swapped.
 * For individual `card` events the data plane appends directly — no reconciliation.
 *
 * NOTE: With backend-assigned `uid` fields, cards that have `uid` will match
 * by uid directly; content-key reconciliation is only the fallback.
 */
export function reconcileCardUids(existingCards: Card[], incomingCards: Card[]): Card[] {
    // Build uid→_uid map from existing cards
    const uidToClientUid = new Map<string, string>();
    const keyToUid = new Map<string, string>();
    for (const c of existingCards) {
        if (c._uid) {
            if (c.uid) uidToClientUid.set(c.uid, c._uid);
            const k = getCardContentKey(c);
            if (k && !keyToUid.has(k)) keyToUid.set(k, c._uid);
        }
    }
    return incomingCards.map((card) => {
        // Prefer matching by backend uid first
        if (card.uid) {
            const preserved = uidToClientUid.get(card.uid);
            if (preserved) return { ...card, _uid: preserved };
            // New card from backend — use its uid as client uid too
            return { ...card, _uid: card.uid };
        }
        // Fall back to content-key matching
        const k = getCardContentKey(card);
        const preservedUid = k ? keyToUid.get(k) : undefined;
        if (preservedUid) {
            keyToUid.delete(k); // Avoid reusing same uid for multiple cards
            return { ...card, _uid: preservedUid };
        }
        return stampUid(card);
    });
}

