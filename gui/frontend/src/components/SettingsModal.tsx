/**
 * Settings modal: container uses useSettingsModal hook; UI is pure presentational.
 */
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, AlertCircle, Save, HelpCircle, ChevronDown, ChevronUp, ExternalLink, Download, RefreshCw, DollarSign, RotateCcw } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useSettingsModal } from '../hooks/useSettingsModal';
import type { ConfigState } from '../hooks/useSettingsModal';

// ---------------------------------------------------------------------------
// Pure presentational component
// ---------------------------------------------------------------------------

const Tooltip = ({ text }: { text: string }) => (
  <div className="group relative inline-block ml-2 shrink-0">
    <HelpCircle className="w-4 h-4 text-text-muted hover:text-text-main cursor-help transition-colors" />
    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-zinc-800 text-zinc-200 text-xs rounded-lg w-64 whitespace-normal leading-relaxed pointer-events-none border border-zinc-700 shadow-xl z-50 text-center">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
    </div>
  </div>
);

const ANKI_CONNECT_ADDON_URL = 'https://ankiweb.net/shared/info/2055492159';

export interface SettingsModalViewProps {
  isOpen: boolean;
  onClose: () => void;
  totalSessionSpend: number;
  onResetSessionSpend: () => void;
  isLoading: boolean;
  error: string | null;
  onRefetchConfig: () => void;
  editedConfig: ConfigState | null;
  onUpdateField: (field: keyof ConfigState, value: string) => void;
  newKey: string;
  onNewKeyChange: (value: string) => void;
  ankiStatus: 'checking' | 'connected' | 'disconnected';
  ankiHint?: string;
  canRetryAnkiConnection: boolean;
  onRetryAnkiConnection: () => void;
  isRetryingAnkiConnection: boolean;
  ankiUrlError: string | null;
  hasChanges: boolean;
  onSave: () => void;
  isSaving: boolean;
  saveSuccess: boolean;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  showBudget: boolean;
  onToggleBudget: () => void;
  versionInfo: { current: string; latest?: string | null; update_available?: boolean; release_url?: string } | null;
  versionLoading: boolean;
  onRefetchVersion: () => void;
}

function SettingsModalView({
  isOpen,
  onClose,
  totalSessionSpend,
  onResetSessionSpend,
  isLoading,
  error,
  onRefetchConfig,
  editedConfig,
  onUpdateField,
  newKey,
  onNewKeyChange,
  ankiStatus,
  ankiHint,
  canRetryAnkiConnection,
  onRetryAnkiConnection,
  isRetryingAnkiConnection,
  ankiUrlError,
  hasChanges,
  onSave,
  isSaving,
  saveSuccess,
  showAdvanced,
  onToggleAdvanced,
  showBudget,
  onToggleBudget,
  versionInfo,
  versionLoading,
  onRefetchVersion,
}: SettingsModalViewProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useFocusTrap(modalRef, { isActive: isOpen, onEscape: onClose, autoFocus: true, restoreFocus: false });

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
          >
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              className="bg-surface border border-border w-full max-w-lg rounded-2xl shadow-2xl pointer-events-auto overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
                <h2 id="settings-title" className="text-xl font-semibold text-text-main flex items-center gap-2">
                  <Settings className="w-5 h-5 text-primary" />
                  Settings
                </h2>
                <button onClick={onClose} aria-label="Close settings" className="p-2 hover:bg-background rounded-lg text-text-muted hover:text-text-main transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto flex-1">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : error ? (
                  <div className="py-8 text-center space-y-4">
                    <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
                    <p className="text-text-muted">{error}</p>
                    <button onClick={onRefetchConfig} aria-label="Retry loading settings" className="px-4 py-2 bg-primary hover:bg-primary/90 text-background rounded-lg font-medium transition-colors">
                      Retry
                    </button>
                  </div>
                ) : editedConfig ? (
                  <>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-muted flex items-center">
                          AI Model
                          <Tooltip text="Flash: Fast, 30 RPM limit. Pro: Smarter, 60 RPM limit. Use Pro for large documents (50+ pages) to avoid rate limits." />
                        </label>
                        <select
                          value={editedConfig.gemini_model}
                          onChange={(e) => onUpdateField('gemini_model', e.target.value)}
                          aria-label="AI Model selection"
                          className="w-full bg-background/50 border-0 rounded-lg py-2.5 px-4 text-text-main focus:ring-1 focus:ring-primary/50 outline-none appearance-none cursor-pointer"
                        >
                          <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                          <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Smart)</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-muted flex items-center">
                          Update API Key
                          <Tooltip text="Your Google Gemini API Key. Stored securely in your system keychain." />
                        </label>
                        <input
                          type="password"
                          value={newKey}
                          onChange={(e) => onNewKeyChange(e.target.value)}
                          placeholder="Enter new Gemini API Key"
                          aria-label="Gemini API Key"
                          className="flex-1 w-full bg-background/50 border-0 rounded-lg py-2.5 px-4 text-text-main focus:ring-1 focus:ring-primary/50 outline-none placeholder:text-text-muted"
                        />
                        <p className="text-[10px] text-text-muted">Leave blank to keep current key.</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-muted flex items-center">
                          Anki Connect
                          <Tooltip text="The address where AnkiConnect is listening. Default: http://localhost:8765" />
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={editedConfig.anki_url}
                            onChange={(e) => onUpdateField('anki_url', e.target.value)}
                            placeholder="http://localhost:8765"
                            aria-label="Anki Connect URL"
                            aria-invalid={ankiUrlError ? 'true' : 'false'}
                            aria-describedby={ankiUrlError ? 'anki-url-error' : undefined}
                            className={`w-full bg-background/50 rounded-lg py-2.5 pl-4 pr-28 text-text-main focus:ring-1 focus:ring-primary/50 outline-none font-mono text-sm ${ankiUrlError ? 'border border-red-500' : 'border-0'}`}
                          />
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                ankiStatus === 'checking' ? 'bg-amber-400 animate-pulse' : ankiStatus === 'connected' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-red-500'
                              }`}
                            />
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                ankiStatus === 'checking' ? 'text-amber-400' : ankiStatus === 'connected' ? 'text-green-500' : 'text-red-400'
                              }`}
                            >
                              {ankiStatus === 'checking' ? 'Checking...' : ankiStatus === 'connected' ? 'Connected' : 'Offline'}
                            </span>
                          </div>
                        </div>
                        {ankiUrlError && (
                          <p id="anki-url-error" className="text-xs text-red-500 mt-1" role="alert">
                            {ankiUrlError}
                          </p>
                        )}
                        {ankiStatus === 'disconnected' && !ankiUrlError && (
                          <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3" role="status">
                            {ankiHint && <p className="text-xs text-amber-100">{ankiHint}</p>}
                            <p className="mt-2 text-[11px] font-medium text-amber-100">Try these actions:</p>
                            <ul className="mt-1 space-y-1">
                              <li className="text-[11px] text-amber-200">• Keep Anki open while using Lectern.</li>
                              <li className="text-[11px] text-amber-200">
                                •{' '}
                                <a
                                  href={ANKI_CONNECT_ADDON_URL}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline decoration-amber-300/40 hover:text-white"
                                >
                                  Open AnkiConnect add-on page
                                </a>
                              </li>
                            </ul>
                          </div>
                        )}
                        {canRetryAnkiConnection && (
                          <button
                            type="button"
                            onClick={onRetryAnkiConnection}
                            disabled={isRetryingAnkiConnection}
                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            aria-label="Ping AnkiConnect again"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRetryingAnkiConnection ? 'animate-spin' : ''}`} />
                            Ping AnkiConnect again
                          </button>
                        )}
                      </div>

                      <div className="pt-2">
                        <button onClick={onToggleAdvanced} className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-primary transition-colors uppercase tracking-wider">
                          {showAdvanced ? <>Hide Advanced <ChevronUp className="w-3 h-3" /></> : <>Show Advanced <ChevronDown className="w-3 h-3" /></>}
                        </button>
                      </div>

                      <AnimatePresence>
                        {showAdvanced && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-text-muted flex items-center">Tag Template</label>
                              <input
                                type="text"
                                value={editedConfig.tag_template}
                                onChange={(e) => onUpdateField('tag_template', e.target.value)}
                                placeholder="{{deck}}::{{slide_set}}::{{topic}}"
                                aria-label="Hierarchical Tag Template"
                                className="w-full bg-background/50 border-0 rounded-lg py-2.5 px-4 text-text-main focus:ring-1 focus:ring-primary/50 outline-none font-mono text-sm"
                              />
                              <p className="text-[10px] text-text-muted mt-1 leading-tight">
                                Example: <code className="text-primary">{'{{deck}}::Lectures::{{topic}}'}</code>
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-text-muted flex items-center">Basic Note Type</label>
                                <input type="text" value={editedConfig.basic_model} onChange={(e) => onUpdateField('basic_model', e.target.value)} aria-label="Basic Note Type" className="w-full bg-background/50 border-0 rounded-lg py-2.5 px-4 text-text-main focus:ring-1 focus:ring-primary/50 outline-none" />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-text-muted flex items-center">Cloze Note Type</label>
                                <input type="text" value={editedConfig.cloze_model} onChange={(e) => onUpdateField('cloze_model', e.target.value)} aria-label="Cloze Note Type" className="w-full bg-background/50 border-0 rounded-lg py-2.5 px-4 text-text-main focus:ring-1 focus:ring-primary/50 outline-none" />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="w-full h-px bg-border my-4" />

                    <div className="space-y-4">
                      <button onClick={onToggleBudget} className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-primary transition-colors uppercase tracking-wider">
                        {showBudget ? <>Hide Budget <ChevronUp className="w-3 h-3" /></> : <>Show Budget <ChevronDown className="w-3 h-3" /></>}
                      </button>
                      <AnimatePresence>
                        {showBudget && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4">
                            <div className="p-4 rounded-xl border border-border bg-background space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <DollarSign className="w-4 h-4 text-primary" />
                                  <span className="text-sm font-medium text-text-main">Session Spend</span>
                                </div>
                                <span className="text-lg font-bold text-primary">${totalSessionSpend.toFixed(2)}</span>
                              </div>
                              <button onClick={onResetSessionSpend} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-surface hover:bg-surface/80 text-text-muted hover:text-text-main rounded-lg text-xs font-medium transition-colors border border-border">
                                <RotateCcw className="w-3 h-3" />
                                Reset Session Spend
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="w-full h-px bg-border my-4" />

                    <div className="space-y-4">
                      <label className="text-sm font-medium text-text-muted flex items-center gap-2">About</label>
                      <div className="p-4 rounded-xl border border-border bg-background space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <p className="text-sm font-semibold text-text-main">Lectern</p>
                            <p className="text-xs text-text-muted">Version {versionInfo?.current ?? '...'}</p>
                          </div>
                          <button onClick={onRefetchVersion} disabled={versionLoading} aria-label="Check for updates" className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors disabled:opacity-50" title="Check for updates">
                            <RefreshCw className={`w-4 h-4 ${versionLoading ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                        {versionInfo?.update_available ? (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                                <Download className="w-4 h-4 text-primary" />
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-sm font-medium text-text-main">Update available!</p>
                                <p className="text-xs text-text-muted">New version v{versionInfo.latest}</p>
                              </div>
                            </div>
                            <a href={versionInfo.release_url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-background rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5">
                              Download <ExternalLink className="w-3 h-3" />
                            </a>
                          </motion.div>
                        ) : versionInfo?.latest ? (
                          <p className="text-[10px] text-text-muted text-center italic">You are running the latest version</p>
                        ) : null}
                        <div className="pt-2 flex items-center justify-center gap-4 text-[10px] text-text-muted">
                          <a href="https://github.com/stegra05/Lectern" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub Repository</a>
                          <span>•</span>
                          <a href="https://github.com/stegra05/Lectern/issues" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Report Issue</a>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="p-6 border-t border-border bg-surface/50 shrink-0">
                {hasChanges ? (
                  <button onClick={onSave} disabled={isSaving} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-background rounded-lg font-medium transition-colors">
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                ) : saveSuccess ? (
                  <p className="text-sm text-primary text-center font-medium">✓ Settings saved successfully</p>
                ) : (
                  <p className="text-sm text-text-muted text-center">Edit fields above to save changes</p>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Container (uses hook, renders view)
// ---------------------------------------------------------------------------

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalSessionSpend: number;
  onResetSessionSpend: () => void;
}

export function SettingsModal({ isOpen, onClose, totalSessionSpend, onResetSessionSpend }: SettingsModalProps) {
  const state = useSettingsModal(isOpen);

  return (
    <SettingsModalView
      isOpen={isOpen}
      onClose={onClose}
      totalSessionSpend={totalSessionSpend}
      onResetSessionSpend={onResetSessionSpend}
      isLoading={state.isLoading}
      error={state.error}
      onRefetchConfig={state.refetchConfig}
      editedConfig={state.editedConfig}
      onUpdateField={state.updateField}
      newKey={state.newKey}
      onNewKeyChange={state.setNewKey}
      ankiStatus={state.ankiStatus}
      ankiHint={state.ankiHint}
      canRetryAnkiConnection={state.canRetryAnkiConnection}
      onRetryAnkiConnection={state.retryAnkiConnection}
      isRetryingAnkiConnection={state.isRetryingAnkiConnection}
      ankiUrlError={state.ankiUrlError}
      hasChanges={state.hasChanges}
      onSave={state.saveConfig}
      isSaving={state.isSaving}
      saveSuccess={state.saveSuccess}
      showAdvanced={state.showAdvanced}
      onToggleAdvanced={() => state.setShowAdvanced(!state.showAdvanced)}
      showBudget={state.showBudget}
      onToggleBudget={() => state.setShowBudget(!state.showBudget)}
      versionInfo={state.versionInfo ?? null}
      versionLoading={state.versionLoading}
      onRefetchVersion={state.refetchVersion}
    />
  );
}
