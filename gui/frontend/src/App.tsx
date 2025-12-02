import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Play, Layers, Settings, CheckCircle2, AlertCircle, Terminal, RotateCcw, Clock, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { api, type ProgressEvent, type HistoryEntry } from './api';
import { GlassCard } from './components/GlassCard';
import { FilePicker } from './components/FilePicker';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingFlow } from './components/OnboardingFlow';
import { ReviewQueue } from './components/ReviewQueue';

function App() {
  const [step, setStep] = useState<'dashboard' | 'config' | 'generating' | 'review' | 'done'>('dashboard');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState('');
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [health, setHealth] = useState<any>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [estimation, setEstimation] = useState<{ tokens: number, cost: number } | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [previewSlide, setPreviewSlide] = useState<number | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const refreshHealth = async () => {
    try {
      const h = await api.checkHealth();
      setHealth(h);
      if (!h.anki_connected || !h.gemini_configured) {
        setShowOnboarding(true);
      } else {
        setShowOnboarding(false);
      }
    } catch (e) {
      console.error(e);
      setShowOnboarding(true);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  // Auto-polling for health status
  useEffect(() => {
    const checkHealth = async () => {
      const result = await api.checkHealth();
      setHealth(result);
      setIsCheckingHealth(false); // Ensure this is set to false after the first check
      if (!result.anki_connected || !result.gemini_configured) {
        setShowOnboarding(true);
      } else {
        setShowOnboarding(false);
      }

      // Fetch history
      const hist = await api.getHistory();
      setHistory(hist);
    };

    // Initial check
    checkHealth();

    // Determine polling interval based on connection status
    const getInterval = () => {
      if (!health) return 3000; // Check frequently until first response
      if (!health.anki_connected || !health.gemini_configured) {
        return 3000; // Poll every 3s when something is offline
      }
      return 30000; // Poll every 30s when everything is online
    };

    // Set up polling
    const interval = setInterval(checkHealth, getInterval());

    // Re-check when window gains focus
    const handleFocus = () => {
      checkHealth();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [health?.anki_connected, health?.gemini_configured]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    const fetchEstimate = async () => {
      if (!pdfFile) {
        setEstimation(null);
        return;
      }
      setIsEstimating(true);
      try {
        const est = await api.estimateCost(pdfFile);
        setEstimation(est);
      } catch (e) {
        console.error(e);
        setEstimation(null);
      } finally {
        setIsEstimating(false);
      }
    };
    fetchEstimate();
  }, [pdfFile]);

  // Refresh history when entering specific states
  useEffect(() => {
    if (step === 'done' || step === 'dashboard') {
      api.getHistory().then(setHistory);
    }
  }, [step]);

  const handleGenerate = async () => {
    if (!pdfFile || !deckName) return;
    setStep('generating');
    setLogs([]);
    setCards([]);

    try {
      await api.generate(
        { pdf_file: pdfFile, deck_name: deckName },
        (event) => {
          setLogs(prev => [...prev, event]);
          if (event.type === 'progress_start') {
            setProgress({ current: 0, total: event.data.total });
          } else if (event.type === 'progress_update') {
            setProgress(prev => ({ ...prev, current: event.data.current }));
          } else if (event.type === 'card_generated') {
            setCards(prev => [event.data.card, ...prev]);
          } else if (event.type === 'done') {
            setStep('review');
          } else if (event.type === 'cancelled') {
            handleReset();
          }
        }
      );
    } catch (e) {
      console.error(e);
      setLogs(prev => [...prev, { type: 'error', message: 'Network error', timestamp: Date.now() }]);
    }
  };

  const handleReset = () => {
    setStep('dashboard');
    setPdfFile(null);
    setDeckName('');
    setLogs([]);
    setCards([]);
    setProgress({ current: 0, total: 0 });
    // Refresh history
    api.getHistory().then(setHistory);
  };

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
          <p className="text-zinc-500 text-sm font-mono tracking-wider animate-pulse">INITIALIZING LECTERN...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100 font-sans selection:bg-primary/20 selection:text-primary">
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

      <div className="relative w-full max-w-[95%] mx-auto p-6 lg:p-8 pt-12 lg:pt-24">
        <header className="mb-16 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col"
          >
            <h1 className="text-5xl font-bold tracking-tight text-white">
              Lectern<span className="text-primary">.</span>
            </h1>
            <p className="text-zinc-500 mt-2 font-medium tracking-wide">AI-POWERED ANKI GENERATOR</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-6"
          >
            <div className="flex items-center gap-3 bg-zinc-900/50 px-4 py-2 rounded-full border border-zinc-800 backdrop-blur-sm">
              <StatusDot label="Anki" active={health?.anki_connected} />
              <div className="w-px h-4 bg-zinc-800" />
              <StatusDot label="Gemini" active={health?.gemini_configured} />
              <button
                onClick={async () => {
                  setIsRefreshingStatus(true);
                  try {
                    const result = await api.checkHealth();
                    setHealth(result);
                  } finally {
                    setIsRefreshingStatus(false);
                  }
                }}
                disabled={isRefreshingStatus}
                className="ml-2 text-zinc-500 hover:text-primary transition-colors disabled:opacity-50"
                title="Refresh status"
              >
                <svg className={clsx("w-3 h-3", isRefreshingStatus && "animate-spin-slow")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-3 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-primary"
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
                      <h2 className="text-lg font-semibold text-zinc-200">Recent Sessions</h2>
                    </div>
                    {history.length > 0 && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm('Are you sure you want to clear all history?')) {
                            await api.clearHistory();
                            setHistory([]);
                          }
                        }}
                        className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear All
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2 scrollbar-thin scrollbar-thumb-zinc-800 max-h-[60vh]">
                    {history.length === 0 ? (
                      <div className="text-zinc-500 text-sm italic text-center py-10">
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
                            className="w-full text-left p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-primary/50 hover:bg-zinc-800/50 transition-all"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="font-medium text-zinc-300 truncate w-full pr-6">{entry.filename}</span>
                              {entry.status === 'completed' && <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />}
                              {entry.status === 'draft' && <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5 shrink-0" />}
                              {entry.status === 'error' && <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />}
                            </div>
                            <div className="flex items-center justify-between text-xs text-zinc-500">
                              <span className="truncate max-w-[120px]">{entry.deck}</span>
                              <span>{entry.card_count} cards</span>
                            </div>
                            <div className="mt-2 text-[10px] text-zinc-600 font-mono">
                              {new Date(entry.date).toLocaleDateString()}
                            </div>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm('Delete this session?')) {
                                await api.deleteHistoryEntry(entry.id);
                                setHistory(prev => prev.filter(h => h.id !== entry.id));
                              }
                            }}
                            className="absolute top-4 right-4 p-1.5 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded-md opacity-0 group-hover:opacity-100 transition-all"
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

                  <h2 className="text-3xl font-bold text-white mb-4">Start New Generation</h2>
                  <p className="text-zinc-400 max-w-md mb-10 leading-relaxed">
                    Create a new Anki deck from your lecture slides. Lectern uses AI to extract concepts and generate high-quality cards.
                  </p>

                  <button
                    onClick={() => {
                      setDeckName('');
                      setPdfFile(null);
                      setStep('config');
                    }}
                    className="relative z-10 px-8 py-4 bg-primary hover:bg-primary/90 text-zinc-900 rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all flex items-center gap-3"
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
                  className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors text-sm font-medium"
                >
                  <RotateCcw className="w-4 h-4" /> Back to Dashboard
                </button>
              </motion.div>

              <motion.div variants={itemVariants} className="lg:col-span-7 space-y-8">
                <GlassCard className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-3">
                      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 font-mono text-sm">01</span>
                      Source Material
                    </h2>
                  </div>
                  <FilePicker file={pdfFile} onFileSelect={setPdfFile} />
                </GlassCard>

                <GlassCard className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-3">
                      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 font-mono text-sm">02</span>
                      Destination
                    </h2>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-500 mb-2 uppercase tracking-wider">Deck Name</label>
                    <input
                      type="text"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      placeholder="University::Subject::Topic"
                      className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-4 px-5 text-lg focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-zinc-700"
                    />
                  </div>
                </GlassCard>
              </motion.div>

              <motion.div variants={itemVariants} className="lg:col-span-5 flex flex-col justify-center">
                <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-3xl p-8 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                  <h3 className="text-2xl font-bold mb-4 text-zinc-200">Ready to Generate?</h3>
                  <p className="text-zinc-400 mb-8 leading-relaxed">
                    Lectern will analyze your slides, extract key concepts, and generate high-quality Anki cards using the configured Gemini model.
                  </p>

                  {(estimation || isEstimating) && (
                    <div className="mb-6 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Estimated Cost</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          {isEstimating ? (
                            <div className="h-6 w-24 bg-zinc-800 animate-pulse rounded" />
                          ) : (
                            <>
                              <span className="text-xl font-bold text-zinc-200">
                                ${estimation?.cost.toFixed(2)}
                              </span>
                              <span className="text-sm text-zinc-500 font-mono">
                                (~{(estimation?.tokens! / 1000).toFixed(1)}k tokens)
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {isEstimating && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
                    </div>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={!pdfFile || !deckName || !health?.anki_connected}
                    className="w-full group relative px-8 py-5 bg-primary hover:bg-primary/90 text-zinc-900 rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
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
                <GlassCard className="flex-1 flex flex-col min-h-0 max-h-[calc(100vh-400px)] border-zinc-800/80">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-semibold text-zinc-300 flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-zinc-500" />
                      Activity Log
                    </h3>
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
                        <button
                          onClick={() => api.stopGeneration()}
                          className="text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1 rounded-md transition-colors border border-red-500/20 font-medium hover:border-red-500/40"
                        >
                          CANCEL
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 font-mono text-xs scrollbar-thin scrollbar-thumb-zinc-700 min-h-0">
                    {logs.map((log, i) => (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={i}
                        className={clsx("flex gap-3 p-2 rounded hover:bg-zinc-800/50 transition-colors", {
                          "text-blue-400": log.type === 'info',
                          "text-yellow-400": log.type === 'warning',
                          "text-red-400": log.type === 'error',
                          "text-primary": log.type === 'note_created',
                          "text-zinc-500": log.type === 'status',
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
                  <div className="flex justify-between text-sm mb-3 text-zinc-400">
                    <span className="font-medium">Progress</span>
                    <span className="font-mono">{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (progress.current / (progress.total || 1)) * 100)}%` }}
                      transition={{ type: "spring", stiffness: 50 }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between text-xs text-zinc-500 font-mono">
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
                        className="w-full py-3 bg-primary hover:bg-primary/90 text-zinc-900 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/10 hover:shadow-primary/20"
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
                      <h3 className="text-lg font-semibold text-zinc-300 flex items-center gap-2">
                        <Layers className="w-5 h-5 text-zinc-500" /> Live Preview
                      </h3>
                      <span className="text-xs font-mono text-zinc-600 bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
                        {cards.length} CARDS
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-12 scrollbar-thin scrollbar-thumb-zinc-700 min-h-0">
                      <AnimatePresence initial={false}>
                        {cards.map((card, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-lg relative overflow-hidden group hover:border-zinc-700 transition-colors"
                          >
                            <div className="absolute top-0 left-0 w-1 h-full bg-primary/50" />
                            <div className="absolute top-4 right-4 text-[10px] font-bold text-zinc-600 uppercase tracking-wider border border-zinc-800 px-2 py-1 rounded bg-zinc-950">
                              {card.model_name || 'Basic'}
                            </div>

                            <div className="space-y-6 mt-2">
                              {Object.entries(card.fields || {}).map(([key, value]) => (
                                <div key={key}>
                                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5">{key}</div>
                                  <div className="text-sm text-zinc-300 leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: String(value) }} />
                                </div>
                              ))}
                            </div>

                            <div className="mt-6 flex flex-wrap gap-2">
                              {(card.tags || []).map((tag: string) => (
                                <span key={tag} className="px-2.5 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-md font-medium border border-zinc-700/50">
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
                                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
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
                        <div className="h-full flex flex-col items-center justify-center text-zinc-600 border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/20">
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

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

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
              className="relative max-w-4xl max-h-full bg-zinc-900 rounded-xl overflow-hidden shadow-2xl border border-zinc-800"
            >
              <div className="absolute top-4 right-4 z-10">
                <button
                  onClick={() => setPreviewSlide(null)}
                  className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-1 bg-zinc-800">
                <img
                  src={`${api.getApiUrl()}/thumbnail/${previewSlide}`}
                  alt={`Slide ${previewSlide}`}
                  className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
                />
              </div>
              <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex justify-between items-center">
                <span className="font-mono text-zinc-400">SLIDE {previewSlide}</span>
                <span className="text-xs text-zinc-600">Source Context</span>
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
    <span className={clsx("text-xs font-medium tracking-wide", active ? "text-zinc-300" : "text-zinc-500")}>
      {label}
    </span>
  </div>
);

export default App;
