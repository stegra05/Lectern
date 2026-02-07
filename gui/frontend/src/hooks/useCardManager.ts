import { useState } from 'react';
import { api, type ProgressEvent, type Card } from '../api';
import type { SortOption } from './types';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from './useAppState';

interface ManagerState {
    sessionId: string | null;
    isHistorical: boolean;
    cards: Card[];
    deckName: string;
}

interface ManagerSetters {
    setCards: React.Dispatch<React.SetStateAction<Card[]>>;
    setDeckName: (name: string) => void;
    setSessionId: (id: string | null) => void;
    setIsHistorical: (hist: boolean) => void;
    setStep: (step: Step) => void;
    setCurrentPhase: (phase: Phase) => void;
}

export function useCardManager(state: ManagerState, setters: ManagerSetters) {
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<Card | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncSuccess, setSyncSuccess] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
    const [syncLogs, setSyncLogs] = useState<ProgressEvent[]>([]);
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        type: 'lectern' | 'anki';
        index: number;
        noteId?: number;
    }>({ isOpen: false, type: 'lectern', index: -1 });

    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem('cardSortBy') as SortOption) || 'creation';
        }
        return 'creation';
    });

    const loadSession = async (sid: string) => {
        try {
            setters.setStep('generating');
            const session = await api.getSession(sid);
            setters.setCards(session.cards || []);
            setters.setDeckName(session.deck_name || '');
            setters.setSessionId(sid);
            setters.setIsHistorical(true);
            setters.setStep('done');
            setters.setCurrentPhase('complete');
        } catch (e) {
            console.error('Failed to load session:', e);
            setters.setStep('dashboard');
        }
    };

    const handleDelete = async (index: number) => {
        try {
            const newCards = [...state.cards];
            newCards.splice(index, 1);

            if (state.isHistorical && state.sessionId) {
                await api.deleteSessionCard(state.sessionId, index);
            } else {
                await api.deleteDraft(index, state.sessionId ?? undefined);
            }

            setters.setCards(newCards);
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (e) {
            console.error("Failed to delete card", e);
        }
    };

    const handleAnkiDelete = async (noteId: number, index: number) => {
        try {
            await api.deleteAnkiNotes([noteId]);
            const newCards = [...state.cards];
            if (newCards[index] && newCards[index].anki_note_id === noteId) {
                delete newCards[index].anki_note_id;
                if (state.isHistorical && state.sessionId) {
                    await api.updateSessionCards(state.sessionId, newCards);
                } else {
                    await api.updateDraft(index, newCards[index], state.sessionId ?? undefined);
                }
                setters.setCards(newCards);
            }
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (e) {
            console.error("Failed to delete Anki note", e);
        }
    };

    const startEdit = (index: number) => {
        setEditingIndex(index);
        setEditForm(JSON.parse(JSON.stringify(state.cards[index])));
    };

    const cancelEdit = () => {
        setEditingIndex(null);
        setEditForm(null);
    };

    const saveEdit = async (index: number) => {
        try {
            if (!editForm) return;
            const newCards = [...state.cards];
            newCards[index] = editForm;

            if (state.isHistorical && state.sessionId) {
                await api.updateSessionCards(state.sessionId, newCards);
            } else {
                await api.updateDraft(index, editForm, state.sessionId ?? undefined);
            }

            if (editForm.anki_note_id && editForm.fields) {
                const stringFields: Record<string, string> = {};
                for (const [k, v] of Object.entries(editForm.fields)) {
                    stringFields[k] = String(v);
                }
                await api.updateAnkiNote(editForm.anki_note_id, stringFields);
            }

            setters.setCards(newCards);
            setEditingIndex(null);
            setEditForm(null);
        } catch (e) {
            console.error("Failed to update card", e);
        }
    };

    const handleFieldChange = (field: string, value: string) => {
        if (!editForm) return;
        const currentFields = (editForm.fields && typeof editForm.fields === 'object') ? editForm.fields : {};
        setEditForm({
            ...editForm,
            fields: {
                ...currentFields,
                [field]: value
            }
        });
    };

    const handleSync = async (onComplete: () => void) => {
        setIsSyncing(true);
        setSyncSuccess(false);
        setSyncLogs([]);
        try {
            const syncFn = state.isHistorical && state.sessionId
                ? (cb: (event: ProgressEvent) => void) => api.syncSessionToAnki(state.sessionId!, cb)
                : (cb: (event: ProgressEvent) => void) => api.syncDrafts(cb, state.sessionId ?? undefined);

            await syncFn(async (event: ProgressEvent) => {
                setSyncLogs(prev => [...prev, event]);
                if (event.type === 'progress_start') {
                    setSyncProgress({ current: 0, total: (event.data as { total: number }).total });
                } else if (event.type === 'progress_update') {
                    setSyncProgress(prev => ({ ...prev, current: (event.data as { current: number }).current }));
                } else if (event.type === 'done') {
                    try {
                        if (state.isHistorical && state.sessionId) {
                            const session = await api.getSession(state.sessionId);
                            setters.setCards(session.cards || []);
                        } else if (state.sessionId) {
                            const drafts = await api.getDrafts(state.sessionId);
                            setters.setCards(drafts.cards || []);
                        }
                    } catch (refreshErr) {
                        console.error("Failed to refresh cards after sync:", refreshErr);
                    }
                    onComplete();
                    setSyncSuccess(true);
                    setTimeout(() => setSyncSuccess(false), 3000);
                }
            });
        } catch (e) {
            console.error("Sync failed", e);
        } finally {
            setIsSyncing(false);
        }
    };

    return {
        editingIndex, setEditingIndex,
        editForm, setEditForm,
        isSyncing, setIsSyncing,
        syncSuccess, setSyncSuccess,
        syncProgress, setSyncProgress,
        syncLogs, setSyncLogs,
        confirmModal, setConfirmModal,
        searchQuery, setSearchQuery,
        sortBy, setSortBy: (opt: SortOption) => {
            setSortBy(opt);
            localStorage.setItem('cardSortBy', opt);
        },
        loadSession,
        handleDelete,
        handleAnkiDelete,
        startEdit,
        cancelEdit,
        saveEdit,
        handleFieldChange,
        handleSync
    };
}
