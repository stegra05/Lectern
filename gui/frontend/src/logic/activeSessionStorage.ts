export const ACTIVE_SESSION_KEY = 'lectern_active_session_id';

const hasWindow = (): boolean => typeof window !== 'undefined';

export const setActiveSessionId = (sessionId: string): void => {
    if (!hasWindow() || !sessionId) return;
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
};

export const clearActiveSessionId = (): void => {
    if (!hasWindow()) return;
    localStorage.removeItem(ACTIVE_SESSION_KEY);
};

export const getActiveSessionId = (): string | null => {
    if (!hasWindow()) return null;
    return localStorage.getItem(ACTIVE_SESSION_KEY);
};
