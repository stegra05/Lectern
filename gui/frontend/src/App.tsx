import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, BookOpen, Settings, Sun, Moon } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from './api';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingFlow } from './components/OnboardingFlow';
import { Toast, ToastContainer } from './components/Toast';

import { useAppState } from './hooks/useAppState';
import { useDebounce } from './hooks/useDebounce';
import { useLecternStore } from './store';
import { useHistory } from './hooks/useHistory';

import { HomeView } from './views/HomeView';
import { ProgressView } from './views/ProgressView';
import { HistoryModal } from './components/HistoryModal';
import { Clock } from 'lucide-react';

// --- Sub-components ---
// ... (StatusDot and HealthStatus omitted for brevity, I'll use targetContent for precise matching)

const StatusDot = ({ label, active }: { label: string, active: boolean }) => (
  <div className="flex items-center gap-2">
    <div className={clsx("w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]", active ? "bg-primary shadow-primary/50" : "bg-red-500 shadow-red-500/50")} />
    <span className={clsx("text-xs font-medium tracking-wide", active ? "text-text-main" : "text-text-muted")}>
      {label}
    </span>
  </div>
);

interface HealthStatusProps {
  health: import('./api').HealthStatus | null;
  isChecking: boolean;
  onRefresh: () => void;
}

const HealthStatus = ({ health, isChecking, onRefresh }: HealthStatusProps) => (
  <div className="flex items-center gap-3 bg-surface/50 px-4 py-2 rounded-full border border-border backdrop-blur-sm">
    <StatusDot label="Anki" active={health?.anki_connected ?? false} />
    <div className="w-px h-4 bg-border" />
    <StatusDot label="Gemini" active={health?.gemini_configured ?? false} />
    <button
      onClick={onRefresh}
      disabled={isChecking}
      className="ml-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
      title="Refresh status"
    >
      <svg className={clsx("w-3 h-3", isChecking && "animate-spin")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  </div>
);


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

  const {
    step,
    pdfFile,
    deckName,
    focusPrompt,
    sourceType,
    targetDeckSize,
    estimation,
    isEstimating,
    estimationError,
    sessionId,
    setPdfFile,
    setDeckName,
    setFocusPrompt,
    setSourceType,
    setTargetDeckSize,
    setEstimation,
    setIsEstimating,
    setEstimationError,
    handleGenerate,
    handleReset,
    loadSession,
    recoverSessionOnRefresh,
    refreshRecoveredSession,
    recommendTargetDeckSize,
  } = useLecternStore();

  const {
    history,
    clearAllHistory,
    deleteHistoryEntry,
    batchDeleteHistory
  } = useHistory(step);

  // NOTE(Estimation): Debounce target card count to avoid many requests during slider drag.
  const debouncedTargetDeckSize = useDebounce(targetDeckSize, 400);
  const previousEstimateContextRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fetchEstimate = async () => {
      if (!pdfFile) {
        setEstimation(null);
        setIsEstimating(false);
        return;
      }
      setIsEstimating(true);
      setEstimationError(null);
      try {
        const est = await api.estimateCost(
          pdfFile,
          health?.gemini_model,
          sourceType,
          debouncedTargetDeckSize,
          controller.signal
        );
        if (!controller.signal.aborted && est) setEstimation(est);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error(e);
          if (!controller.signal.aborted) {
            setEstimation(null);
            const msg = (e as Error).message || 'Estimation failed';
            setEstimationError(
              msg.includes('500') ? 'Estimation failed — check your Gemini API key in Settings.' : `Estimation failed: ${msg}`
            );
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsEstimating(false);
        }
      }
    };
    fetchEstimate();
    return () => controller.abort();
  }, [pdfFile, health?.gemini_model, sourceType, debouncedTargetDeckSize, setEstimation, setIsEstimating, setEstimationError]);

  useEffect(() => {
    if (!pdfFile) {
      previousEstimateContextRef.current = null;
      return;
    }
    if (estimation?.suggested_card_count === undefined) return;

    const contextKey = `${pdfFile.name}:${pdfFile.size}:${pdfFile.lastModified}:${sourceType}`;
    if (previousEstimateContextRef.current !== contextKey) {
      recommendTargetDeckSize(estimation);
      previousEstimateContextRef.current = contextKey;
    }
  }, [pdfFile, sourceType, estimation, recommendTargetDeckSize]);

  useEffect(() => {
    recoverSessionOnRefresh();
  }, [recoverSessionOnRefresh]);

  useEffect(() => {
    if (step !== 'generating' || !sessionId) return undefined;
    const interval = window.setInterval(() => {
      refreshRecoveredSession();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [refreshRecoveredSession, sessionId, step]);

  if (isCheckingHealth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-text-muted text-sm font-mono tracking-wider animate-pulse">INITIALIZING LECTERN...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-text-main font-sans selection:bg-primary/20 selection:text-primary transition-colors duration-300">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden text-primary/5">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-current rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[95%] mx-auto p-6 lg:p-8 pt-6 lg:pt-10">
        <header className="mb-8 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col"
          >
            <button
              onClick={() => {
                if (step !== 'dashboard') {
                  api.stopGeneration(sessionId ?? undefined);
                  handleReset();
                }
              }}
              className="group text-left transition-transform active:scale-95"
            >
              <h1 className="text-5xl font-bold tracking-tight text-text-main group-hover:text-primary transition-colors">
                Lectern<span className="text-primary group-hover:text-text-main transition-colors">.</span>
              </h1>
              <div className="flex items-center gap-2 mt-2">
                <BookOpen className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
                <p className="text-text-muted font-medium tracking-wide group-hover:text-primary/70 transition-colors uppercase text-xs">AI-POWERED ANKI GENERATOR</p>
              </div>
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-6"
          >
            <div className="flex items-center gap-3">
              <HealthStatus health={health} isChecking={isRefreshingStatus} onRefresh={refreshHealth} />
              <button
                onClick={() => setIsHistoryOpen(true)}
                className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
                title="Recent Sessions"
              >
                <Clock className="w-5 h-5" />
              </button>
              <button
                onClick={toggleTheme}
                className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
                title="Toggle Theme"
              >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        </header>

        <main className="relative">
          <AnimatePresence mode="wait">
            {showOnboarding ? (
              <OnboardingFlow key="onboarding" onComplete={refreshHealth} />
            ) : (
              <motion.div
                key="content"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <AnimatePresence mode="wait">
                  {(step === 'dashboard' || step === 'config') && (
                    <HomeView
                      key="home"
                      pdfFile={pdfFile}
                      setPdfFile={setPdfFile}
                      deckName={deckName}
                      setDeckName={setDeckName}
                      sourceType={sourceType}
                      setSourceType={setSourceType}
                      targetDeckSize={targetDeckSize}
                      setTargetDeckSize={setTargetDeckSize}
                      focusPrompt={focusPrompt}
                      setFocusPrompt={setFocusPrompt}
                      estimation={estimation}
                      isEstimating={isEstimating}
                      estimationError={estimationError}
                      handleGenerate={handleGenerate}
                      health={health}
                    />
                  )}

                  {(step === 'generating' || step === 'done') && (
                    <ProgressView key="progress" />
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        clearAllHistory={clearAllHistory}
        deleteHistoryEntry={deleteHistoryEntry}
        batchDeleteHistory={batchDeleteHistory}
        loadSession={loadSession}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      <StoreToasts />


    </div>
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