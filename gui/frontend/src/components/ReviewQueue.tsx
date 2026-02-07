import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit2, Save, X, UploadCloud, AlertCircle, Layers, Archive } from 'lucide-react';
import { api, type ProgressEvent } from '../api';
import { GlassCard } from './GlassCard';
import { ConfirmModal } from './ConfirmModal';

interface ReviewQueueProps {
    initialCards: any[];
    onSyncComplete: () => void;
    sessionId?: string | null;
    isHistorical?: boolean;
}

export function ReviewQueue({ initialCards, onSyncComplete, sessionId, isHistorical }: ReviewQueueProps) {
    const [cards, setCards] = useState<any[]>(initialCards);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<any>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
    const [syncLogs, setSyncLogs] = useState<ProgressEvent[]>([]);
    const [previewSlide, setPreviewSlide] = useState<number | null>(null);
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        type: 'lectern' | 'anki';
        index: number;
        noteId?: number;
    }>({ isOpen: false, type: 'lectern', index: -1 });

    useEffect(() => {
        setCards(initialCards);
    }, [initialCards]);

    const handleDelete = async (index: number) => {
        try {
            const newCards = [...cards];
            newCards.splice(index, 1);

            if (isHistorical && sessionId) {
                await api.updateSessionCards(sessionId, newCards);
                // Also call deleteSessionCard API to ensure history count is updated
                // The above updateSessionCards does save state, but deleteSessionCard 
                // is specifically built to return 'remaining' and update history.
                // However, updateSessionCards overwrites everything so it's safer for consistency.
                // But we should use deleteSessionCard for single deletions if we want the history count update logic 
                // which I added to delete_session_card endpoint.
                // Let's use deleteSessionCard endpoint instead of updateSessionCards for single deletion.
                await api.deleteSessionCard(sessionId, index);
            } else {
                await api.deleteDraft(index, sessionId ?? undefined);
            }

            setCards(newCards);
        } catch (e) {
            console.error("Failed to delete card", e);
        }
    };

    const handleAnkiDelete = async (noteId: number, index: number) => {
        try {
            await api.deleteAnkiNotes([noteId]);
            // Clear anki_note_id from card but keep card
            const newCards = [...cards];
            // Check if card still exists at index (it should)
            if (newCards[index] && newCards[index].anki_note_id === noteId) {
                delete newCards[index].anki_note_id;
                if (isHistorical && sessionId) {
                    await api.updateSessionCards(sessionId, newCards);
                } else {
                    await api.updateDraft(index, newCards[index], sessionId ?? undefined);
                }
                setCards(newCards);
            }
        } catch (e) {
            console.error("Failed to delete Anki note", e);
        }
    };

    const startEdit = (index: number) => {
        setEditingIndex(index);
        setEditForm(JSON.parse(JSON.stringify(cards[index]))); // Deep copy
    };

    const cancelEdit = () => {
        setEditingIndex(null);
        setEditForm(null);
    };

    const saveEdit = async (index: number) => {
        try {
            const newCards = [...cards];
            newCards[index] = editForm;

            if (isHistorical && sessionId) {
                await api.updateSessionCards(sessionId, newCards);
            } else {
                await api.updateDraft(index, editForm, sessionId ?? undefined);
            }

            setCards(newCards);
            setEditingIndex(null);
            setEditForm(null);
        } catch (e) {
            console.error("Failed to update card", e);
        }
    };

    const handleFieldChange = (field: string, value: string) => {
        if (!editForm) return;
        setEditForm({
            ...editForm,
            fields: {
                ...editForm.fields,
                [field]: value
            }
        });
    };

    const handleSync = async () => {
        setIsSyncing(true);
        setSyncLogs([]);
        try {
            const syncFn = isHistorical && sessionId
                ? (cb: any) => api.syncSessionToAnki(sessionId, cb)
                : (cb: any) => api.syncDrafts(cb, sessionId ?? undefined);

            await syncFn((event: any) => {
                setSyncLogs(prev => [...prev, event]);
                if (event.type === 'progress_start') {
                    setSyncProgress({ current: 0, total: event.data.total });
                } else if (event.type === 'progress_update') {
                    setSyncProgress(prev => ({ ...prev, current: event.data.current }));
                } else if (event.type === 'done') {
                    onSyncComplete();
                } else if (event.type === 'note_updated' || event.type === 'note_recreated' || event.type === 'note_created') {
                    // Note status is implicitly updated via log display
                }
            });
        } catch (e) {
            console.error("Sync failed", e);
            setIsSyncing(false);
        }
    };

    if (isSyncing) {
        return (
            <div className="space-y-6">
                <GlassCard className="border-primary/20 bg-primary/5">
                    <div className="flex flex-col items-center justify-center py-12 gap-6">
                        <div className="relative w-16 h-16">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle
                                    cx="32"
                                    cy="32"
                                    r="28"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    fill="none"
                                    className="text-primary/20"
                                />
                                <circle
                                    cx="32"
                                    cy="32"
                                    r="28"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    fill="none"
                                    className="text-primary transition-all duration-300 ease-out"
                                    strokeDasharray={175.93}
                                    strokeDashoffset={175.93 - (175.93 * syncProgress.current) / (syncProgress.total || 1)}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-primary">
                                {Math.round((syncProgress.current / (syncProgress.total || 1)) * 100)}%
                            </div>
                        </div>
                        <div className="text-center">
                            <h3 className="text-xl font-bold text-text-main">Syncing to Anki...</h3>
                            <p className="text-text-muted mt-2">Exporting {cards.length} cards to your collection</p>
                        </div>
                    </div>
                </GlassCard>

                <div className="max-h-60 overflow-y-auto space-y-2 font-mono text-xs pr-2 scrollbar-thin scrollbar-thumb-border">
                    {syncLogs.map((log, i) => (
                        <div key={i} className="text-text-muted">
                            <span className="opacity-50 mr-2">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                            {log.message}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-text-main">Review Queue</h2>
                    <p className="text-text-muted">Review, edit, or delete cards before syncing to Anki.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm font-mono text-text-muted bg-surface px-3 py-1.5 rounded-lg border border-border">
                        {cards.length} DRAFTS
                    </div>
                    <button
                        onClick={handleSync}
                        disabled={cards.length === 0}
                        className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <UploadCloud className="w-4 h-4" />
                        Sync to Anki
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 pr-2 scrollbar-thin scrollbar-thumb-border grid gap-4 content-start">
                <AnimatePresence mode="popLayout">
                    {cards.map((card, index) => (
                        <motion.div
                            key={index} // Ideally use a unique ID if available
                            layout
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="group relative"
                        >
                            <GlassCard className={`transition-colors ${editingIndex === index ? 'border-primary/50 bg-primary/5' : 'hover:border-border/80'}`}>
                                {editingIndex === index ? (
                                    // Edit Mode
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-xs font-bold text-primary uppercase tracking-wider">Editing Card #{index + 1}</span>
                                            <div className="flex items-center gap-2">
                                                <button onClick={cancelEdit} className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors">
                                                    <X className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => saveEdit(index)} className="p-2 bg-primary hover:bg-primary/90 text-background rounded-lg transition-colors">
                                                    <Save className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="grid gap-4">
                                            {Object.entries(editForm.fields || {}).map(([key, value]) => (
                                                <div key={key}>
                                                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">{key}</label>
                                                    <textarea
                                                        value={value as string}
                                                        onChange={(e) => handleFieldChange(key, e.target.value)}
                                                        className="w-full bg-surface/50 border border-border rounded-lg p-3 text-sm text-text-main focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none min-h-[100px] font-mono"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    // View Mode
                                    <div className="relative pr-12">
                                        <div className="absolute top-0 right-0 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => startEdit(index)}
                                                className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-primary transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>

                                            <button
                                                onClick={() => setConfirmModal({
                                                    isOpen: true,
                                                    type: 'lectern',
                                                    index
                                                })}
                                                className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors"
                                                title="Remove from Lectern"
                                            >
                                                <Archive className="w-4 h-4" />
                                            </button>

                                            {card.anki_note_id && (
                                                <button
                                                    onClick={() => setConfirmModal({
                                                        isOpen: true,
                                                        type: 'anki',
                                                        index,
                                                        noteId: card.anki_note_id
                                                    })}
                                                    className="p-2 hover:bg-red-500/10 rounded-lg text-red-300 hover:text-red-400 transition-colors"
                                                    title="Delete from Anki"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>

                                        <div className="space-y-4">
                                            {Object.entries(card.fields || {}).map(([key, value]) => (
                                                <div key={key}>
                                                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">{key}</div>
                                                    <div className="text-sm text-text-main leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: String(value) }} />
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {(card.tags || []).map((tag: string) => (
                                                <span key={tag} className="px-2 py-0.5 bg-surface text-text-muted text-[10px] rounded-md font-medium border border-border uppercase tracking-wide">
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>

                                        {card.slide_number && (
                                            <div className="absolute bottom-0 right-0">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPreviewSlide(card.slide_number);
                                                    }}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface hover:bg-surface/80 border border-border text-[10px] font-medium text-text-muted hover:text-text-main transition-colors"
                                                >
                                                    <Layers className="w-3 h-3" />
                                                    SLIDE {card.slide_number}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </GlassCard>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {cards.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted border-2 border-dashed border-border rounded-xl">
                        <AlertCircle className="w-8 h-8 mb-3 opacity-20" />
                        <p>No drafts remaining.</p>
                    </div>
                )}
            </div>

            {/* Thumbnail Modal */}
            <AnimatePresence>
                {/* ... existing thumbnail modal ... */}
            </AnimatePresence>

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                onConfirm={() => {
                    if (confirmModal.type === 'lectern') {
                        handleDelete(confirmModal.index);
                    } else if (confirmModal.type === 'anki' && confirmModal.noteId) {
                        handleAnkiDelete(confirmModal.noteId, confirmModal.index);
                    }
                }}
                title={confirmModal.type === 'lectern' ? "Remove from Lectern?" : "Permanently Delete from Anki?"}
                description={
                    confirmModal.type === 'lectern' ? (
                        <>
                            This will remove the card from your current session view.
                            <br /><br />
                            <strong>Note:</strong> If this card is synced to Anki, it will <em>remain in Anki</em>.
                        </>
                    ) : (
                        <>
                            Are you sure you want to delete this card from Anki?
                            <br /><br />
                            <strong className="text-red-400">This action cannot be undone.</strong>
                        </>
                    )
                }
                confirmText={confirmModal.type === 'lectern' ? "Remove" : "Delete Permanently"}
                variant={confirmModal.type === 'lectern' ? 'default' : 'destructive'}
            />

            <AnimatePresence>
                {previewSlide !== null && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setPreviewSlide(null)}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            className="relative max-w-4xl max-h-full bg-surface rounded-xl overflow-hidden shadow-2xl border border-border"
                        >
                            <div className="absolute top-4 right-4 z-10">
                                <button
                                    onClick={() => setPreviewSlide(null)}
                                    className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-1 bg-background">
                                <img
                                    src={`${api.getApiUrl()}/thumbnail/${previewSlide}${sessionId ? `?session_id=${sessionId}` : ""}`}
                                    alt={`Slide ${previewSlide}`}
                                    className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
                                />
                            </div>
                            <div className="p-4 bg-surface border-t border-border flex justify-between items-center">
                                <span className="font-mono text-text-muted">SLIDE {previewSlide}</span>
                                <span className="text-xs text-text-muted">Source Context</span>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
