/**
 * Onboarding flow: container uses useOnboardingFlow hook; UI is pure presentational.
 */
import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, RefreshCw, Terminal, Server, BrainCircuit, AlertCircle, Lock, Unlock, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useOnboardingFlow } from '../hooks/useOnboardingFlow';
import type { StepStatus } from '../hooks/useOnboardingFlow';
import { GlassCard } from './GlassCard';

// ---------------------------------------------------------------------------
// Pure presentational components
// ---------------------------------------------------------------------------

function StepIndicator({ status, icon: Icon }: { status: StepStatus; icon: React.ElementType }) {
  return (
    <div className="absolute left-0 top-0 w-10 h-10 flex items-center justify-center">
      <div
        className={clsx(
          'w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-500 z-10',
          status === 'pending' && 'bg-zinc-900 border-zinc-800 text-zinc-700',
          status === 'active' && 'bg-zinc-900 border-primary/50 text-primary shadow-[0_0_15px_rgba(163,230,53,0.1)]',
          status === 'success' && 'bg-primary border-primary text-zinc-900',
          status === 'error' && 'bg-red-500/10 border-red-500 text-red-500'
        )}
      >
        {status === 'success' ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
      </div>
      {status === 'active' && (
        <>
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-20 animate-ping" />
          <span className="absolute inline-flex h-[140%] w-[140%] rounded-full border border-primary/20 opacity-50 animate-pulse" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container (uses hook, renders view)
// ---------------------------------------------------------------------------

interface OnboardingProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingProps) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const state = useOnboardingFlow(onComplete);

  useFocusTrap(containerRef, {
    isActive: !state.isExiting,
    onEscape: undefined,
    autoFocus: true,
    restoreFocus: false,
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <AnimatePresence>
        {!state.isExiting && (
          <motion.div
            ref={containerRef}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0, y: -200, x: 200 }}
            transition={{ type: 'spring', duration: 0.8 }}
            onMouseMove={handleMouseMove}
            className="relative w-full max-w-md group"
          >
            <div
              className="absolute pointer-events-none inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(163, 230, 53, 0.06), transparent 40%)`,
              }}
              aria-hidden="true"
            />

            <GlassCard className="relative overflow-hidden border-zinc-700/50 shadow-2xl bg-zinc-900/90">
              <div className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-zinc-800 rounded-lg border border-zinc-700">
                    <Terminal className="w-5 h-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 id="onboarding-title" className="text-lg font-bold text-zinc-100">
                      System Check
                    </h2>
                    <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Pre-Flight Sequence</p>
                  </div>
                </div>
                <div className="flex gap-1" aria-hidden="true">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500/20" />
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/20" />
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500/20" />
                </div>
              </div>

              <div className="space-y-8 relative">
                <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-zinc-800 -z-10" />

                <div className="relative">
                  <StepIndicator status={state.ankiStatus} icon={Server} />
                  <div className="ml-14 pt-1">
                    <h3 className={clsx('font-medium transition-colors', state.ankiStatus === 'active' ? 'text-zinc-200' : 'text-zinc-500')}>
                      Anki Connection
                    </h3>

                    {state.ankiStatus === 'active' && <p className="text-sm text-zinc-500 mt-1 animate-pulse">Establishing connection...</p>}
                    {state.ankiStatus === 'success' && (
                      <motion.p initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-primary font-mono mt-1">
                        CONNECTED: LOCALHOST:8765
                      </motion.p>
                    )}

                    {state.ankiStatus === 'error' && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm"
                        role="alert"
                      >
                        <div className="flex items-start gap-2 text-red-200">
                          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                          <div className="space-y-2">
                            <p>Connection failed. Is Anki running with AnkiConnect?</p>
                            <div className="text-xs text-red-300">
                              <p>1. Open Anki → Tools → Add-ons</p>
                              <p>
                                2. Get Add-ons → Code: <span className="font-mono bg-red-500/20 px-1 rounded select-all">2055492159</span>
                              </p>
                              <p>3. Restart Anki</p>
                            </div>
                            <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer" className="inline-block text-xs underline hover:text-white">
                              AnkiConnect Page
                            </a>
                          </div>
                        </div>
                        <button
                          onClick={state.retryAnki}
                          aria-label="Retry Anki connection"
                          className="mt-3 w-full py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2"
                        >
                          <RefreshCw className="w-3 h-3" aria-hidden="true" /> Retry Connection
                        </button>
                        <button
                          onClick={state.skipAnki}
                          className="mt-2 w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-medium transition-colors border border-zinc-700/50"
                        >
                          Continue Offline (Save as Drafts)
                        </button>
                      </motion.div>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <StepIndicator status={state.geminiStatus === 'pending' && state.ankiStatus !== 'success' ? 'pending' : state.geminiStatus} icon={BrainCircuit} />
                  <div className="ml-14 pt-1">
                    <h3 className={clsx('font-medium transition-colors', state.geminiStatus === 'active' ? 'text-zinc-200' : 'text-zinc-500')}>AI Service</h3>

                    {state.geminiStatus === 'active' && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                        <div className="flex justify-between items-center mb-1.5">
                          <label htmlFor="gemini-api-key" className="block text-xs text-zinc-500">
                            GEMINI API KEY
                          </label>
                          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline">
                            Get Free Key
                          </a>
                        </div>
                        <div className="relative group/input">
                          <input
                            id="gemini-api-key"
                            type="password"
                            value={state.apiKey}
                            onChange={(e) => state.setApiKey(e.target.value)}
                            placeholder="sk-..."
                            aria-label="Gemini API Key"
                            aria-describedby="api-key-help"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-4 pr-10 text-sm text-zinc-200 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 outline-none transition-all font-mono"
                          />
                          <div className="absolute right-3 top-3 text-zinc-600 transition-colors duration-300" aria-hidden="true">
                            {state.apiKey.length > 10 ? <Unlock className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4" />}
                          </div>
                          <div
                            className="absolute bottom-0 left-0 h-[1px] bg-primary transition-all duration-300"
                            style={{ width: state.apiKey.length > 0 ? '100%' : '0%', opacity: state.apiKey.length > 0 ? 1 : 0 }}
                            aria-hidden="true"
                          />
                        </div>

                        <button
                          onClick={state.submitApiKey}
                          disabled={state.apiKey.length < 10 || state.saveApiKeyStatus === 'pending'}
                          aria-label="Initialize with API key"
                          className="mt-4 w-full py-2.5 bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-900 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2"
                        >
                          Initialize <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </button>

                        <p id="api-key-help" className="mt-3 text-[10px] text-zinc-600 text-center">
                          Your key is securely stored in the system keychain.
                        </p>
                      </motion.div>
                    )}

                    {state.geminiStatus === 'success' && <p className="text-xs text-primary font-mono mt-1">AUTHENTICATED</p>}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
