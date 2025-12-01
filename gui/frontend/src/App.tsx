import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Play, FileText, Layers } from 'lucide-react';
import { clsx } from 'clsx';
import { api, type ProgressEvent } from './api';
import { GlassCard } from './components/GlassCard';

function App() {
  const [step, setStep] = useState<'config' | 'generating' | 'done'>('config');
  const [pdfPath, setPdfPath] = useState('');
  const [deckName, setDeckName] = useState('');
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [health, setHealth] = useState<any>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.checkHealth().then(setHealth).catch(console.error);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleGenerate = async () => {
    if (!pdfPath || !deckName) return;
    setStep('generating');
    setLogs([]);
    setCards([]);

    try {
      await api.generate(
        { pdf_path: pdfPath, deck_name: deckName },
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

  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-sans selection:bg-blue-500/30">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-[#0f172a] to-[#0f172a] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto p-8">
        <header className="mb-12 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              Lectern
            </h1>
            <p className="text-gray-400 mt-2">AI-Powered Anki Card Generator</p>
          </div>
          <div className="flex items-center gap-4">
            <StatusBadge label="Anki" active={health?.anki_connected} />
            <StatusBadge label="Gemini" active={health?.gemini_configured} />
          </div>
        </header>

        <AnimatePresence mode="wait">
          {step === 'config' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              <GlassCard className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" /> Source
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">PDF Path</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={pdfPath}
                      onChange={(e) => setPdfPath(e.target.value)}
                      placeholder="/Users/me/lecture.pdf"
                      className="w-full bg-gray-900/50 border border-gray-700 rounded-lg py-3 px-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                    {/* File picker button could go here if we had native access */}
                  </div>
                </div>
              </GlassCard>

              <GlassCard className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Layers className="w-5 h-5 text-purple-400" /> Destination
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Deck Name</label>
                  <input
                    type="text"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    placeholder="University::History"
                    className="w-full bg-gray-900/50 border border-gray-700 rounded-lg py-3 px-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                  />
                </div>
              </GlassCard>

              <div className="md:col-span-2 flex justify-center mt-4">
                <button
                  onClick={handleGenerate}
                  disabled={!pdfPath || !deckName || !health?.anki_connected}
                  className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-full font-bold text-lg shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  <span className="flex items-center gap-2">
                    <Play className="w-5 h-5 fill-current" /> Start Generation
                  </span>
                </button>
              </div>
            </motion.div>
          )}

          {step !== 'config' && (
            <motion.div
              key="progress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[calc(100vh-200px)]"
            >
              {/* Left: Logs & Progress */}
              <div className="lg:col-span-1 flex flex-col gap-6">
                <GlassCard className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-300">Activity Log</h3>
                    {step === 'generating' && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 font-mono text-sm scrollbar-thin scrollbar-thumb-gray-700">
                    {logs.map((log, i) => (
                      <div key={i} className={clsx("flex gap-2", {
                        "text-blue-400": log.type === 'info',
                        "text-yellow-400": log.type === 'warning',
                        "text-red-400": log.type === 'error',
                        "text-green-400": log.type === 'note_created',
                        "text-gray-500": log.type === 'status',
                      })}>
                        <span className="opacity-50 text-xs mt-1">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                        <span>{log.message}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </GlassCard>

                <GlassCard>
                  <div className="flex justify-between text-sm mb-2 text-gray-400">
                    <span>Progress</span>
                    <span>{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between text-xs text-gray-500">
                    <span>Generated: {cards.length}</span>
                    <span>Target: {progress.total}</span>
                  </div>
                </GlassCard>
              </div>

              {/* Right: Live Preview */}
              <div className="lg:col-span-2 flex flex-col min-h-0">
                <h3 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-green-400" /> Live Preview
                </h3>
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-12 scrollbar-thin scrollbar-thumb-gray-700">
                  <AnimatePresence initial={false}>
                    {cards.map((card, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white text-gray-900 rounded-lg p-6 shadow-lg border-l-4 border-blue-500"
                      >
                        <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">
                          {card.model_name || 'Basic'}
                        </div>
                        <div className="space-y-4">
                          {Object.entries(card.fields || {}).map(([key, value]) => (
                            <div key={key}>
                              <div className="text-xs text-gray-500 font-semibold uppercase">{key}</div>
                              <div className="text-sm mt-1" dangerouslySetInnerHTML={{ __html: String(value) }} />
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 flex gap-2">
                          {(card.tags || []).map((tag: string) => (
                            <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {cards.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 border-2 border-dashed border-gray-800 rounded-xl">
                      <Loader2 className="w-8 h-8 animate-spin mb-2 opacity-20" />
                      <p>Waiting for cards...</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const StatusBadge = ({ label, active }: { label: string, active: boolean }) => (
  <div className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border", {
    "bg-green-500/10 border-green-500/20 text-green-400": active,
    "bg-red-500/10 border-red-500/20 text-red-400": !active,
  })}>
    <div className={clsx("w-1.5 h-1.5 rounded-full", active ? "bg-green-400" : "bg-red-400")} />
    {label}
  </div>
);

export default App;
