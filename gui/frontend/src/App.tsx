import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { OnboardingFlow } from './components/OnboardingFlow';
import { Toast, ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppHeader } from './components/AppHeader';
import { ModalOrchestrator } from './components/ModalOrchestrator';

import { useAppState } from './hooks/useAppState';
import { useAnkiStatusQuery } from './queries';
import { useLecternStore } from './store';
import { useHasUnsyncedCards } from './hooks/useLecternSelectors';
import { useHistory } from './hooks/useHistory';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useReviewOrchestrator } from './hooks/useReviewOrchestrator';

import { HomeView } from './views/HomeView';
import { ProgressView } from './views/ProgressView';
// --- Main App ---


function App() {
  const {
    health,
    showOnboarding,
    isCheckingHealth,
    isSettingsOpen, setIsSettingsOpen,
    isHistoryOpen, setIsHistoryOpen,
    theme, toggleTheme,
    isRefreshingStatus, refreshHealth
  } = useAppState();

  // Keyboard shortcuts modal state
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);

  // Anki health panel state
  const [isAnkiHealthOpen, setIsAnkiHealthOpen] = useState(false);
  const { data: ankiStatus, isLoading: ankiStatusLoading, refetch: refetchAnkiStatus, dataUpdatedAt: ankiStatusUpdatedAt } = useAnkiStatusQuery(isAnkiHealthOpen);

  // Unsynced cards confirmation state
  const [isUnsyncedConfirmOpen, setIsUnsyncedConfirmOpen] = useState(false);
  const pendingGenerateCallbackRef = useRef<(() => void) | null>(null);

  // Get sync state for unsynced check
  const hasUnsyncedCards = useHasUnsyncedCards();
  const cards = useLecternStore((s) => s.cards);

  const step = useLecternStore((s) => s.step);
  const handleGenerate = useLecternStore((s) => s.handleGenerate);
  const handleCancelAndReset = useLecternStore((s) => s.handleCancelAndReset);
  const loadSession = useLecternStore((s) => s.loadSession);
  const recoverSessionOnRefresh = useLecternStore((s) => s.recoverSessionOnRefresh);
  const handleResume = useLecternStore((s) => s.handleResume);
  const setPdfFile = useLecternStore((s) => s.setPdfFile);

  // Budget actions and state for settings
  const totalSessionSpend = useLecternStore((s) => s.totalSessionSpend);
  const resetSessionSpend = useLecternStore((s) => s.resetSessionSpend);

  const {
    history,
    clearAllHistory,
    deleteHistoryEntry,
    batchDeleteHistory
  } = useHistory(step);

  // Keyboard shortcuts - get edit state and actions from store
  const editingIndex = useLecternStore((s) => s.editingIndex);
  const { saveEdit } = useReviewOrchestrator();
  const cancelEdit = useLecternStore((s) => s.cancelEdit);
  const handleDelete = useLecternStore((s) => s.handleDelete);

  // Focus callbacks for keyboard shortcuts - use DOM queries since inputs are in child components
  const focusSearch = useCallback(() => {
    const searchInput = document.querySelector('input[placeholder="Search..."]') as HTMLInputElement | null;
    searchInput?.focus();
  }, []);

  const focusDeckSelector = useCallback(() => {
    const deckInput = document.querySelector('input[placeholder="University::Subject::Topic"]') as HTMLInputElement | null;
    deckInput?.focus();
  }, []);

  // Wire up keyboard shortcuts
  const shortcuts = useKeyboardShortcuts({
    isSettingsOpen,
    setIsSettingsOpen,
    isHistoryOpen,
    setIsHistoryOpen,
    isShortcutsModalOpen,
    setIsShortcutsModalOpen,
    focusSearch,
    focusDeckSelector,
    isEditing: editingIndex !== null,
    saveEdit: () => {
      if (editingIndex !== null) {
        saveEdit(editingIndex);
      }
    },
    cancelEdit,
    selectedCardIndex: null, // Card selection not yet implemented
    deleteCard: handleDelete,
  });

  // Estimation side effects have been moved to useEstimationLogic hook
  // which is called by HomeView to prevent App.tsx from subscribing
  // to estimation state changes and causing full app re-renders.

  useEffect(() => {
    recoverSessionOnRefresh();
  }, [recoverSessionOnRefresh]);

  // NOTE: No polling during active generation. The NDJSON stream is the single authoritative
  // writer for cards. refreshRecoveredSession was removed to prevent racing with the stream
  // and overwriting live state with stale persisted snapshots.

  // beforeunload handler for browser close/refresh when there are unsynced cards
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsyncedCards) {
        // Standard way to trigger browser's native confirmation dialog
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue = 'You have unsaved cards. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsyncedCards]);

  // Wrapped generate handler that checks for unsynced cards
  const handleGenerateWithConfirm = useCallback(() => {
    if (hasUnsyncedCards) {
      // Show confirmation dialog
      pendingGenerateCallbackRef.current = handleGenerate;
      setIsUnsyncedConfirmOpen(true);
    } else {
      handleGenerate();
    }
  }, [hasUnsyncedCards, handleGenerate]);

  const handleConfirmGenerate = useCallback(() => {
    setIsUnsyncedConfirmOpen(false);
    if (pendingGenerateCallbackRef.current) {
      pendingGenerateCallbackRef.current();
      pendingGenerateCallbackRef.current = null;
    }
  }, []);

  const handleCancelGenerate = useCallback(() => {
    setIsUnsyncedConfirmOpen(false);
    pendingGenerateCallbackRef.current = null;
  }, []);

  // Resume session handler - opens file picker and calls handleResume
  const handleResumeSession = useCallback((sessionId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setPdfFile(file);
        handleResume(sessionId, file);
      }
    };
    input.click();
  }, [handleResume, setPdfFile]);

  if (isCheckingHealth) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-text-muted text-sm font-mono tracking-wider animate-pulse">INITIALIZING LECTERN...</p>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-text-main font-sans selection:bg-primary/20 selection:text-primary transition-colors duration-300">
        {/* Ambient Background */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden text-primary/5">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-current rounded-full blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[120px]" />
        </div>

        <div className="relative w-full max-w-[95%] mx-auto p-6 lg:p-8 pt-6 lg:pt-10">
          <AppHeader
            health={health}
            isCheckingHealth={isCheckingHealth}
            isRefreshingStatus={isRefreshingStatus}
            theme={theme}
            onLogoClick={() => {
              if (step !== 'dashboard') handleCancelAndReset();
            }}
            onRefreshHealth={refreshHealth}
            onHistoryClick={() => setIsHistoryOpen(true)}
            onSettingsClick={() => setIsSettingsOpen(true)}
            onThemeToggle={toggleTheme}
            onAnkiClick={() => setIsAnkiHealthOpen(true)}
          />

          <main className="relative">
            <AnimatePresence mode="wait">
              {showOnboarding ? (
                <OnboardingFlow key="onboarding" onComplete={refreshHealth} />
              ) : (step === 'dashboard' || step === 'config') ? (
                <HomeView
                  key="home"
                  handleGenerate={handleGenerateWithConfirm}
                  health={health}
                />
              ) : (
                <ProgressView key="progress" />
              )}
            </AnimatePresence>
          </main>
        </div>

        <ModalOrchestrator
          settings={{
            isOpen: isSettingsOpen,
            totalSessionSpend,
          }}
          history={{
            isOpen: isHistoryOpen,
            entries: history ?? [],
          }}
          shortcuts={{
            isOpen: isShortcutsModalOpen,
            config: shortcuts,
          }}
          unsyncedConfirm={{
            isOpen: isUnsyncedConfirmOpen,
            cardCount: cards.length,
          }}
          ankiHealth={{
            isOpen: isAnkiHealthOpen,
            status: ankiStatus,
            isLoading: ankiStatusLoading,
            lastChecked: ankiStatusUpdatedAt ? new Date(ankiStatusUpdatedAt) : null,
          }}
          onCloseSettings={() => setIsSettingsOpen(false)}
          onResetSessionSpend={resetSessionSpend}
          onCloseHistory={() => setIsHistoryOpen(false)}
          onClearAllHistory={clearAllHistory}
          onDeleteHistoryEntry={deleteHistoryEntry}
          onBatchDeleteHistory={(params) => batchDeleteHistory(params)}
          onLoadSession={loadSession}
          onResumeSession={handleResumeSession}
          onCloseShortcuts={() => setIsShortcutsModalOpen(false)}
          onConfirmUnsynced={handleConfirmGenerate}
          onCancelUnsynced={handleCancelGenerate}
          onCloseAnkiHealth={() => setIsAnkiHealthOpen(false)}
          onOpenSettingsFromAnki={() => {
            setIsAnkiHealthOpen(false);
            setIsSettingsOpen(true);
          }}
          onRefetchAnkiStatus={() => refetchAnkiStatus()}
        />

        <StoreToasts />


      </div>
    </ErrorBoundary>
  );
}

/** Renders toasts from the Zustand store reactively. */
function StoreToasts() {
  const toasts = useLecternStore((s) => s.toasts);
  const dismissToast = useLecternStore((s) => s.dismissToast);
  return (
    <ToastContainer>
      {toasts.map((t) => (
        <Toast key={t.id} {...t} onDismiss={dismissToast} />
      ))}
    </ToastContainer>
  );
}

export default App;