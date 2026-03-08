import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stampUid, stampUids, getCardContentKey, reconcileCardUids } from '../utils/uid';
import type { Card } from '../api';

describe('uid utils', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('stampUid', () => {
        it('preserves existing _uid', () => {
            const card: Card = { front: 'A', back: 'B', _uid: 'existing-uid' };
            expect(stampUid(card)).toBe(card);
            expect(stampUid(card)._uid).toBe('existing-uid');
        });

        it('adds _uid when missing', () => {
            const card: Card = { front: 'A', back: 'B' };
            const result = stampUid(card);
            expect(result._uid).toBeDefined();
            expect(typeof result._uid).toBe('string');
            expect(result._uid!.length).toBeGreaterThan(0);
        });
    });

    describe('getCardContentKey', () => {
        it('uses front when available', () => {
            expect(getCardContentKey({ front: 'Hello World' })).toBe('hello world');
        });

        it('uses fields.Front when front is empty', () => {
            expect(getCardContentKey({ fields: { Front: 'Test' } })).toBe('test');
        });

        it('uses text for cloze cards', () => {
            expect(getCardContentKey({ text: 'Cloze content' })).toBe('cloze content');
        });

        it('normalizes whitespace', () => {
            expect(getCardContentKey({ front: '  multiple   spaces  ' })).toBe('multiple spaces');
        });
    });

    describe('reconcileCardUids', () => {
        it('preserves _uid when content matches', () => {
            const existing: Card[] = [
                { front: 'A', back: 'B', _uid: 'uid-1' },
                { front: 'C', back: 'D', _uid: 'uid-2' },
            ];
            const incoming: Card[] = [
                { front: 'A', back: 'B' },
                { front: 'C', back: 'D' },
            ];
            const result = reconcileCardUids(existing, incoming);
            expect(result[0]._uid).toBe('uid-1');
            expect(result[1]._uid).toBe('uid-2');
        });

        it('stamps new _uid for cards with different content', () => {
            const existing: Card[] = [{ front: 'A', back: 'B', _uid: 'uid-1' }];
            const incoming: Card[] = [{ front: 'X', back: 'Y' }];
            const result = reconcileCardUids(existing, incoming);
            expect(result[0]._uid).toBeDefined();
            expect(result[0]._uid).not.toBe('uid-1');
        });

        it('does not reuse same _uid for duplicate content keys', () => {
            const existing: Card[] = [{ front: 'Same', back: 'X', _uid: 'uid-1' }];
            const incoming: Card[] = [
                { front: 'Same', back: 'X' },
                { front: 'Same', back: 'X' },
            ];
            const result = reconcileCardUids(existing, incoming);
            expect(result[0]._uid).toBe('uid-1');
            expect(result[1]._uid).toBeDefined();
            expect(result[1]._uid).not.toBe('uid-1');
        });

        it('handles empty existing', () => {
            const incoming: Card[] = [{ front: 'A', back: 'B' }];
            const result = reconcileCardUids([], incoming);
            expect(result[0]._uid).toBeDefined();
        });
    });
});
