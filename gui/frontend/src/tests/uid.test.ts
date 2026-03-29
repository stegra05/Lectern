import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stampUid, reconcileCardUids } from '../utils/uid';
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

        it('adds _uid from backend uid when missing', () => {
            const card: Card = { front: 'A', back: 'B', uid: 'backend-uid' };
            const result = stampUid(card);
            expect(result._uid).toBe('backend-uid');
        });
        
        it('returns fallback when backend uid is missing', () => {
            const card: Card = { front: 'A', back: 'B' };
            const result = stampUid(card);
            expect(result._uid).toMatch(/^fallback-/);
        });
    });

    describe('reconcileCardUids', () => {
        it('preserves _uid when backend uid matches', () => {
            const existing: Card[] = [
                { front: 'A', back: 'B', uid: 'u1', _uid: 'uid-1' },
                { front: 'C', back: 'D', uid: 'u2', _uid: 'uid-2' },
            ];
            const incoming: Card[] = [
                { front: 'A', back: 'B', uid: 'u1' },
                { front: 'C', back: 'D', uid: 'u2' },
            ];
            const result = reconcileCardUids(existing, incoming);
            expect(result[0]._uid).toBe('uid-1');
            expect(result[1]._uid).toBe('uid-2');
        });

        it('uses incoming backend uid when no previous mapping exists', () => {
            const existing: Card[] = [{ front: 'A', back: 'B', uid: 'u1', _uid: 'uid-1' }];
            const incoming: Card[] = [{ front: 'X', back: 'Y', uid: 'u2' }];
            const result = reconcileCardUids(existing, incoming);
            expect(result[0]._uid).toBe('u2');
        });

        it('returns fallback when incoming backend uid is missing', () => {
            const incoming: Card[] = [{ front: 'A', back: 'B' }];
            const result = reconcileCardUids([], incoming);
            expect(result[0]._uid).toMatch(/^fallback-/);
        });
    });
});
