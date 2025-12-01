import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Play, Layers, Settings, CheckCircle2, AlertCircle, Terminal } from 'lucide-react';
import { clsx } from 'clsx';
import { api, type ProgressEvent } from './api';
import { GlassCard } from './components/GlassCard';
import { FilePicker } from './components/FilePicker';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingFlow } from './components/OnboardingFlow';

function App() {
  const [step, setStep] = useState<'config' | 'generating' | 'done'>('config');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState('');
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [health, setHealth] = useState<any>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
            setStep('done');
          }
        }
      );
    } catch (e) {
      console.error(e);
      setLogs(prev => [...prev, { type: 'error', message: 'Network error', timestamp: Date.now() }]);
    }
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

      <div className="relative max-w-6xl mx-auto p-6 lg:p-12">
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
                  const result = await api.checkHealth();
                  setHealth(result);
                }}
                className="ml-2 text-zinc-500 hover:text-primary transition-colors"
                title="Refresh status"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          {step === 'config' && !showOnboarding && (
            <motion.div
              key="config"
              variants={containerVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
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

          {step !== 'config' && (
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
                    {step === 'generating' ? (
                      <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 px-2 py-1 rounded-md">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        PROCESSING
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-md">
                        <CheckCircle2 className="w-3 h-3" />
                        COMPLETE
                      </div>
                    )}
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
                      animate={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                      transition={{ type: "spring", stiffness: 50 }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between text-xs text-zinc-500 font-mono">
                    <span>GENERATED: {cards.length}</span>
                    <span>TARGET: {progress.total}</span>
                  </div>
                </GlassCard>
              </div>

              {/* Right: Live Preview */}
              <div className="lg:col-span-2 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
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
