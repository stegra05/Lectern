import type { Card } from '../api';

/** Stamp a stable `_uid` onto a card (no-op if already present). */
export const stampUid = (card: Card): Card =>
    card._uid ? card : { ...card, _uid: crypto.randomUUID() };

/** Stamp UIDs on an array of cards. */
export const stampUids = (cards: Card[]): Card[] => cards.map(stampUid);
