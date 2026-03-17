import { SettingsModal } from './SettingsModal';
import { HistoryModal } from './HistoryModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { ConfirmModal } from './ConfirmModal';
import { AnkiHealthPanel } from './AnkiHealthPanel';
import type { HistoryEntry, AnkiStatus } from '../schemas/api';
import type { KeyboardShortcut } from '../hooks/useKeyboardShortcuts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModalOrchestratorProps {
    /** Settings modal state */
    settings: {
        isOpen: boolean;
        totalSessionSpend: number;
    };
    /** History modal state */
    history: {
        isOpen: boolean;
        entries: HistoryEntry[];
    };
    /** Keyboard shortcuts modal state */
    shortcuts: {
        isOpen: boolean;
        config: KeyboardShortcut[];
    };
    /** Unsynced cards confirmation modal state */
    unsyncedConfirm: {
        isOpen: boolean;
        cardCount: number;
    };
    /** Anki health panel state */
    ankiHealth: {
        isOpen: boolean;
        status: AnkiStatus | undefined;
        isLoading: boolean;
        lastChecked: Date | null;
    };
    /** Event handlers */
    onCloseSettings: () => void;
    onResetSessionSpend: () => void;
    onCloseHistory: () => void;
    onClearAllHistory: () => void;
    onDeleteHistoryEntry: (id: string) => void;
    onBatchDeleteHistory: (ids: string[]) => void;
    onLoadSession: (sessionId: string) => void;
    onCloseShortcuts: () => void;
    onConfirmUnsynced: () => void;
    onCancelUnsynced: () => void;
    onCloseAnkiHealth: () => void;
    onOpenSettingsFromAnki: () => void;
    onRefetchAnkiStatus: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModalOrchestrator({
    settings,
    history,
    shortcuts,
    unsyncedConfirm,
    ankiHealth,
    onCloseSettings,
    onResetSessionSpend,
    onCloseHistory,
    onClearAllHistory,
    onDeleteHistoryEntry,
    onBatchDeleteHistory,
    onLoadSession,
    onCloseShortcuts,
    onConfirmUnsynced,
    onCancelUnsynced,
    onCloseAnkiHealth,
    onOpenSettingsFromAnki,
    onRefetchAnkiStatus,
}: ModalOrchestratorProps) {
    return (
        <>
            <HistoryModal
                isOpen={history.isOpen}
                onClose={onCloseHistory}
                history={history.entries}
                clearAllHistory={onClearAllHistory}
                deleteHistoryEntry={onDeleteHistoryEntry}
                batchDeleteHistory={(params) => onBatchDeleteHistory(params.ids ?? [])}
                loadSession={onLoadSession}
            />

            <SettingsModal
                isOpen={settings.isOpen}
                onClose={onCloseSettings}
                totalSessionSpend={settings.totalSessionSpend}
                onResetSessionSpend={onResetSessionSpend}
            />

            <KeyboardShortcutsModal
                isOpen={shortcuts.isOpen}
                onClose={onCloseShortcuts}
                shortcuts={shortcuts.config}
            />

            <ConfirmModal
                isOpen={unsyncedConfirm.isOpen}
                title="Unsynced Cards"
                description={`You have ${unsyncedConfirm.cardCount} card${unsyncedConfirm.cardCount !== 1 ? 's' : ''} that haven't been synced to Anki. Starting a new session will discard these cards. Continue anyway?`}
                confirmText="Start New Session"
                cancelText="Cancel"
                variant="destructive"
                onConfirm={onConfirmUnsynced}
                onClose={onCancelUnsynced}
            />

            <AnkiHealthPanel
                isOpen={ankiHealth.isOpen}
                onClose={onCloseAnkiHealth}
                onOpenSettings={onOpenSettingsFromAnki}
                status={ankiHealth.status}
                isLoading={ankiHealth.isLoading}
                onRefetch={onRefetchAnkiStatus}
                lastChecked={ankiHealth.lastChecked}
            />
        </>
    );
}
