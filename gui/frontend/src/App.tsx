import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Play, Layers, Settings, CheckCircle2, AlertCircle, Terminal, RotateCcw, Clock, ChevronRight, Plus, Trash2, Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from './api';
import { GlassCard } from './components/GlassCard';
import { FilePicker } from './components/FilePicker';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingFlow } from './components/OnboardingFlow';
import { ReviewQueue } from './components/ReviewQueue';
import { PhaseIndicator } from './components/PhaseIndicator';

import { useAppState } from './hooks/useAppState';
import { useGeneration } from './hooks/useGeneration';
import { useHistory } from './hooks/useHistory';

function App() {
  const { 
    step, setStep, 
    health,
    showOnboarding,
    isCheckingHealth, 
    isSettingsOpen, setIsSettingsOpen, 
    theme, toggleTheme,
    isRefreshingStatus, refreshHealth 
  } = useAppState();

  const {
    pdfFile, setPdfFile,
    deckName, setDeckName,
    logs,
    cards,
    progress,
    estimation,
    isEstimating,
    previewSlide, setPreviewSlide,
    isCancelling,
    currentPhase,
    examMode, toggleExamMode,
    handleGenerate,
    handleReset,
    handleCancel,
    logsEndRef,
    handleCopyLogs,
    copied
  } = useGeneration(setStep);

  const {
    history,
    setHistory,
    clearAllHistory,
    deleteHistoryEntry
  } = useHistory(step);

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

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
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[120px]" />
      </div>

      <AnimatePresence>
        {showOnboarding && (
          <OnboardingFlow onComplete={refreshHealth} />
        )}
      </AnimatePresence>

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
                  api.stopGeneration();
                  handleReset();
                }
              }}
              className="group text-left transition-transform active:scale-95"
            >
              <h1 className="text-5xl font-bold tracking-tight text-text-main group-hover:text-primary transition-colors">
                Lectern<span className="text-primary group-hover:text-text-main transition-colors">.</span>
              </h1>
              <p className="text-text-muted mt-2 font-medium tracking-wide group-hover:text-primary/70 transition-colors">AI-POWERED ANKI GENERATOR</p>
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-6"
          >
            <div className="flex items-center gap-3 bg-surface/50 px-4 py-2 rounded-full border border-border backdrop-blur-sm">
              <StatusDot label="Anki" active={health?.anki_connected} />
              <div className="w-px h-4 bg-border" />
              <StatusDot label="Gemini" active={health?.gemini_configured} />
              <button
                onClick={refreshHealth}
                disabled={isRefreshingStatus}
                className="ml-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
                title="Refresh status"
              >
                <svg className={clsx("w-3 h-3", isRefreshingStatus && "animate-spin-slow")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
            >
              <Settings className="w-5 h-5" />
            </button>
          </motion.div>
        </header>

        <AnimatePresence mode="wait">
          {step === 'dashboard' && !showOnboarding && (
            <motion.div
              key="dashboard"
              variants={containerVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Sidebar: Recent Files */}
              <motion.div variants={itemVariants} className="lg:col-span-4 space-y-6">
                <GlassCard className="h-full min-h-[500px] flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-primary" />
                      <h2 className="text-lg font-semibold text-text-main">Recent Sessions</h2>
                    </div>
                    {history.length > 0 && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          clearAllHistory();
                        }}
                        className="text-xs text-text-muted hover:text-red-400 transition-colors flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear All
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2 scrollbar-thin scrollbar-thumb-border max-h-[60vh]">
                    {history.length === 0 ? (
                      <div className="text-text-muted text-sm italic text-center py-10">
                        No recent sessions found.
                      </div>
                    ) : (
                      history.map((entry) => (
                        <div
                          key={entry.id}
                          className="relative group"
                        >
                          <button
                            onClick={() => {
                              setDeckName(entry.deck);
                              setStep('config');
                            }}
                            className="w-full text-left p-4 rounded-xl bg-surface/50 border border-border hover:border-primary/50 hover:bg-surface transition-all"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="font-medium text-text-main truncate w-full pr-6">{entry.filename}</span>
                              {entry.status === 'completed' && <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />}
                              {entry.status === 'draft' && <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5 shrink-0" />}
                              {entry.status === 'error' && <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />}
                            </div>
                            <div className="flex items-center justify-between text-xs text-text-muted">
                              <span className="truncate max-w-[120px]">{entry.deck}</span>
                              <span>{entry.card_count} cards</span>
                            </div>
                            <div className="mt-2 text-[10px] text-text-muted font-mono">
                              {new Date(entry.date).toLocaleDateString()}
                            </div>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              deleteHistoryEntry(entry.id);
                            }}
                            className="absolute top-4 right-4 p-1.5 text-text-muted hover:text-red-400 hover:bg-surface rounded-md opacity-0 group-hover:opacity-100 transition-all"
                            title="Delete Session"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </GlassCard>
              </motion.div>

              {/* Main Area: New Generation */}
              <motion.div variants={itemVariants} className="lg:col-span-8">
                <GlassCard className="h-full flex flex-col justify-center items-center text-center p-12 border-primary/20 bg-primary/5 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                  <div className="w-20 h-20 bg-primary/20 rounded-3xl flex items-center justify-center mb-8 text-primary shadow-[0_0_30px_rgba(0,0,0,0.2)] shadow-primary/20">
                    <Plus className="w-10 h-10" />
                  </div>

                  <h2 className="text-3xl font-bold text-text-main mb-4">Start New Generation</h2>
                  <p className="text-text-muted max-w-md mb-10 leading-relaxed">
                    Create a new Anki deck from your lecture slides. Lectern uses AI to extract concepts and generate high-quality cards.
                  </p>

                  <button
                    onClick={() => {
                      setDeckName('');
                      setPdfFile(null);
                      setStep('config');
                    }}
                    className="relative z-10 px-8 py-4 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all flex items-center gap-3"
                  >
                    Create New Deck
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </GlassCard>
              </motion.div>
            </motion.div>
          )}

          {step === 'config' && !showOnboarding && (
            <motion.div
              key="config"
              variants={containerVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              <motion.div variants={itemVariants} className="lg:col-span-12 mb-4">
                <button
                  onClick={() => setStep('dashboard')}
                  className="flex items-center gap-2 text-text-muted hover:text-text-main transition-colors text-sm font-medium"
                >
                  <RotateCcw className="w-4 h-4" /> Back to Dashboard
                </button>
              </motion.div>

              <motion.div variants={itemVariants} className="lg:col-span-7 space-y-8">
                <GlassCard className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-3">
                      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">01</span>
                      Source Material
                    </h2>
                  </div>
                  <FilePicker file={pdfFile} onFileSelect={setPdfFile} />
                </GlassCard>

                <GlassCard className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-3">
                      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">02</span>
                      Destination
                    </h2>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">Deck Name</label>
                    <input
                      type="text"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      placeholder="University::Subject::Topic"
                      className="w-full bg-surface/50 border border-border rounded-xl py-4 px-5 text-lg focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-text-muted"
                    />
                  </div>

                  {/* Exam Mode Toggle */}
                  <div className="pt-4 border-t border-border/50">
                    <button
                      onClick={toggleExamMode}
                      className={clsx(
                        "w-full flex items-center justify-between p-4 rounded-xl border transition-all",
                        examMode
                          ? "bg-primary/10 border-primary/30 hover:border-primary/50"
                          : "bg-surface/30 border-border/50 hover:border-border"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={clsx(
                          "w-10 h-10 rounded-lg flex items-center justify-center text-lg",
                          examMode ? "bg-primary/20 text-primary" : "bg-surface text-text-muted"
                        )}>
                          🎯
                        </div>
                        <div className="text-left">
                          <div className={clsx(
                            "font-semibold",
                            examMode ? "text-primary" : "text-text-main"
                          )}>Exam Mode</div>
                          <div className="text-xs text-text-muted">
                            {examMode ? "Comparison & application cards" : "Standard card generation"}
                          </div>
                        </div>
                      </div>
                      <div className={clsx(
                        "w-12 h-6 rounded-full p-1 transition-colors",
                        examMode ? "bg-primary" : "bg-surface"
                      )}>
                        <div className={clsx(
                          "w-4 h-4 rounded-full bg-white shadow transition-transform",
                          examMode ? "translate-x-6" : "translate-x-0"
                        )} />
                      </div>
                    </button>
                    {examMode && (
                      <p className="mt-2 text-xs text-primary/70 px-2">
                        🎓 Prioritizes understanding over memorization. 30% comparison, 25% application, 25% intuition, 20% definition cards.
                      </p>
                    )}
                  </div>
                </GlassCard>
              </motion.div>

              <motion.div variants={itemVariants} className="lg:col-span-5 flex flex-col justify-center">
                <div className="bg-surface/30 border border-border/50 rounded-3xl p-8 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                  <h3 className="text-2xl font-bold mb-4 text-text-main">Ready to Generate?</h3>
                  <p className="text-text-muted mb-8 leading-relaxed">
                    Lectern will analyze your slides, extract key concepts, and generate high-quality Anki cards using the configured Gemini model.
                  </p>

                  {(estimation || isEstimating) && (
                    <div className="mb-6 p-4 rounded-xl bg-surface/50 border border-border/50 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Estimated Cost</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          {isEstimating ? (
                            <div className="h-6 w-24 bg-surface animate-pulse rounded" />
                          ) : (
                            <>
                              <span className="text-xl font-bold text-text-main">
                                ${estimation?.cost.toFixed(2)}
                              </span>
                              <span className="text-sm text-text-muted font-mono">
                                (~{(estimation?.tokens! / 1000).toFixed(1)}k tokens)
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {isEstimating && <Loader2 className="w-4 h-4 text-text-muted animate-spin" />}
                    </div>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={!pdfFile || !deckName || !health?.anki_connected}
                    className="w-full group relative px-8 py-5 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                  >
                    <span className="relative z-10 flex items-center justify-center gap-3">
                      <Play className="w-5 h-5 fill-current" />
                      Start Generation
                    </span>
                  </button>

                  {!health?.anki_connected && (
                    <div className="mt-4 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                      <AlertCircle className="w-4 h-4" />
                      <span>Anki is not connected. Please start Anki.</span>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}

          {(step === 'generating' || step === 'done' || step === 'review') && (
            <motion.div
              key="progress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-[calc(100vh-200px)]"
            >
              {/* Left: Logs & Progress */}
              <div className="lg:col-span-1 flex flex-col gap-6 max-h-[calc(100vh-200px)]">
                {step === 'generating' && (
                  <GlassCard className="shrink-0">
                    <h3 className="font-semibold text-text-main mb-4 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-text-muted" />
                      Generation Status
                    </h3>
                    <PhaseIndicator currentPhase={currentPhase} />
                  </GlassCard>
                )}

                <GlassCard className="flex-1 flex flex-col min-h-0 max-h-[calc(100vh-400px)] border-border/80">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-semibold text-text-main flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-text-muted" />
                      Activity Log
                    </h3>
                    <div className="flex items-center gap-2">
                      {logs.length > 0 && (
                        <button
                          onClick={handleCopyLogs}
                          className="p-1 text-text-muted hover:text-primary transition-colors rounded-md hover:bg-surface/80"
                          title="Copy logs"
                        >
                          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                      <div className="flex items-center gap-3">
                        {step === 'generating' ? (
                          <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span className="font-medium tracking-wide">PROCESSING</span>
                          </div>
                        ) : (
                          step === 'done' && (
                            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-md border border-green-500/20">
                              <CheckCircle2 className="w-3 h-3" />
                              <span className="font-medium tracking-wide">COMPLETE</span>
                            </div>
                          )
                        )}
                        {step === 'generating' && (
                          isCancelling ? (
                            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 px-3 py-1 rounded-md border border-red-500/20">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span className="font-medium tracking-wide">CANCELLING...</span>
                            </div>
                          ) : (
                            <button
                              onClick={handleCancel}
                              className="text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1 rounded-md transition-colors border border-red-500/20 font-medium hover:border-red-500/40"
                            >
                              CANCEL
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 font-mono text-xs scrollbar-thin scrollbar-thumb-border min-h-0">
                    {logs.map((log, i) => (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={i}
                        className={clsx("flex gap-3 p-2 rounded hover:bg-surface/50 transition-colors", {
                          "text-blue-400": log.type === 'info',
                          "text-yellow-400": log.type === 'warning',
                          "text-red-400": log.type === 'error',
                          "text-primary": log.type === 'note_created',
                          "text-text-muted": log.type === 'status',
                          "text-primary font-bold": log.type === 'step_start',
                        })}
                      >
                        <span className="opacity-30 shrink-0">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                        <span className="break-words">{log.message}</span>
                      </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </GlassCard>

                <GlassCard>
                  <div className="flex justify-between text-sm mb-3 text-text-muted">
                    <span className="font-medium">Progress</span>
                    <span className="font-mono">{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (progress.current / (progress.total || 1)) * 100)}%` }}
                      transition={{ type: "spring", stiffness: 50 }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between text-xs text-text-muted font-mono">
                    <span>GENERATED: {cards.length}</span>
                  </div>
                </GlassCard>

                {step === 'done' && (
                  <GlassCard className="border-primary/20 bg-primary/5">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3 text-primary">
                        <CheckCircle2 className="w-6 h-6" />
                        <div>
                          <h3 className="font-bold">Generation Complete</h3>
                          <p className="text-xs text-primary/70">All cards have been exported to Anki</p>
                        </div>
                      </div>
                      <button
                        onClick={handleReset}
                        className="w-full py-3 bg-primary hover:bg-primary/90 text-background rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/10 hover:shadow-primary/20"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Start New Session
                      </button>
                    </div>
                  </GlassCard>
                )}
              </div>

              {/* Right: Live Preview or Review Queue */}
              <div className="lg:col-span-2 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
                {step === 'review' ? (
                  <ReviewQueue
                    initialCards={cards}
                    onSyncComplete={() => setStep('done')}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-text-main flex items-center gap-2">
                        <Layers className="w-5 h-5 text-text-muted" /> Live Preview
                      </h3>
                      <span className="text-xs font-mono text-text-muted bg-surface px-2 py-1 rounded border border-border">
                        {cards.length} CARDS
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-12 scrollbar-thin scrollbar-thumb-border min-h-0">
                      <AnimatePresence initial={false}>
                        {cards.map((card, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="bg-surface border border-border rounded-xl p-6 shadow-lg relative overflow-hidden group hover:border-border/80 transition-colors"
                          >
                            <div className="absolute top-0 left-0 w-1 h-full bg-primary/50" />
                            <div className="absolute top-4 right-4 text-[10px] font-bold text-text-muted uppercase tracking-wider border border-border px-2 py-1 rounded bg-background">
                              {card.model_name || 'Basic'}
                            </div>

                            <div className="space-y-6 mt-2">
                              {Object.entries(card.fields || {}).map(([key, value]) => (
                                <div key={key}>
                                  <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1.5">{key}</div>
                                  <div className="text-sm text-text-main leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: String(value) }} />
                                </div>
                              ))}
                            </div>

                            <div className="mt-6 flex flex-wrap gap-2">
                              {(card.tags || []).map((tag: string) => (
                                <span key={tag} className="px-2.5 py-1 bg-background text-text-muted text-xs rounded-md font-medium border border-border">
                                  #{tag}
                                </span>
                              ))}
                            </div>

                            {card.slide_number && (
                              <div className="absolute bottom-4 right-4">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewSlide(card.slide_number);
                                  }}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-background hover:bg-surface border border-border text-[10px] font-medium text-text-muted hover:text-text-main transition-colors"
                                >
                                  <Layers className="w-3 h-3" />
                                  SLIDE {card.slide_number}
                                </button>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {cards.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-text-muted border-2 border-dashed border-border rounded-xl bg-surface/20">
                          <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
                          <p className="font-medium">Waiting for cards...</p>
                          <p className="text-sm opacity-50 mt-1">Generation will start shortly</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} theme={theme} toggleTheme={toggleTheme} />

      {/* Thumbnail Modal */}
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-1 bg-background">
                <img
                  src={`${api.getApiUrl()}/thumbnail/${previewSlide}`}
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

const StatusDot = ({ label, active }: { label: string, active: boolean }) => (
  <div className="flex items-center gap-2">
    <div className={clsx("w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]", active ? "bg-primary shadow-primary/50" : "bg-red-500 shadow-red-500/50")} />
    <span className={clsx("text-xs font-medium tracking-wide", active ? "text-text-main" : "text-text-muted")}>
      {label}
    </span>
  </div>
);

export default App;