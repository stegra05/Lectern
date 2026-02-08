import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, AlertCircle, Save, HelpCircle, ChevronDown, ChevronUp, ExternalLink, Download, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { api } from '../api';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
}

interface ConfigState {
    gemini_model: string;
    anki_url: string;
    basic_model: string;
    cloze_model: string;
}

export function SettingsModal({ isOpen, onClose, theme, toggleTheme }: SettingsModalProps) {
    const [config, setConfig] = useState<ConfigState | null>(null);
    const [editedConfig, setEditedConfig] = useState<ConfigState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newKey, setNewKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [versionInfo, setVersionInfo] = useState<{ current: string; latest: string | null; update_available: boolean; release_url: string } | null>(null);
    const [checkLoading, setCheckLoading] = useState(false);

    const Tooltip = ({ text }: { text: string }) => (
        <div className="group relative inline-block ml-2">
            <HelpCircle className="w-4 h-4 text-text-muted hover:text-text-main cursor-help" />
            <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-zinc-800 text-zinc-200 text-xs rounded-lg whitespace-nowrap pointer-events-none border border-zinc-700 shadow-xl z-50">
                {text}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
            </div>
        </div>
    );

    const hasChanges = config && editedConfig && (
        config.gemini_model !== editedConfig.gemini_model ||
        config.anki_url !== editedConfig.anki_url ||
        config.basic_model !== editedConfig.basic_model ||
        config.cloze_model !== editedConfig.cloze_model
    );

    const loadConfig = async () => {
        setLoading(true);
        setError(null);
        setSaveSuccess(false);
        try {
            const data = await api.getConfig();
            setConfig(data);
            setEditedConfig(data);
            setNewKey('');
        } catch (err) {
            setError('Failed to connect to backend');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveKey = async () => {
        if (!newKey.trim()) return;
        setIsSaving(true);
        try {
            await api.saveConfig({ gemini_api_key: newKey });
            await loadConfig();
            setNewKey('');
        } catch (err) {
            console.error(err);
            setError('Failed to save key');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveSettings = async () => {
        if (!editedConfig || !hasChanges) return;
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await api.saveConfig({
                gemini_model: editedConfig.gemini_model,
                anki_url: editedConfig.anki_url,
                basic_model: editedConfig.basic_model,
                cloze_model: editedConfig.cloze_model,
            });
            setConfig(editedConfig);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err) {
            console.error(err);
            setError('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const updateField = (field: keyof ConfigState, value: string) => {
        if (!editedConfig) return;
        setEditedConfig({ ...editedConfig, [field]: value });
    };

    const checkUpdates = async () => {
        setCheckLoading(true);
        try {
            const info = await api.getVersion();
            setVersionInfo(info);
        } catch (err) {
            console.error('Failed to check updates:', err);
        } finally {
            setCheckLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadConfig();
            checkUpdates();
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
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
                    >
                        <div className="bg-surface border border-border w-full max-w-lg rounded-2xl shadow-2xl pointer-events-auto overflow-hidden max-h-[90vh] flex flex-col">
                            <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
                                <h2 className="text-xl font-semibold text-text-main flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-primary" />
                                    Settings
                                </h2>
                                <button
                                    onClick={onClose}
                                    aria-label="Close settings"
                                    className="p-2 hover:bg-background rounded-lg text-text-muted hover:text-text-main transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-6 overflow-y-auto flex-1">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-text-muted">Appearance</label>
                                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface">
                                        <span className="text-text-main text-sm">Dark Mode</span>
                                        <button
                                            onClick={toggleTheme}
                                            role="switch"
                                            aria-checked={theme === 'dark'}
                                            aria-label="Toggle dark mode"
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background ${theme === 'dark' ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                                        >
                                            <span
                                                className={`${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                                            />
                                        </button>
                                    </div>
                                </div>

                                <div className="w-full h-px bg-border my-4" />

                                {loading ? (
                                    <div className="flex justify-center py-8">
                                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : error ? (
                                    <div className="py-8 text-center space-y-4">
                                        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
                                        <p className="text-text-muted">{error}</p>
                                        <button
                                            onClick={loadConfig}
                                            className="px-4 py-2 bg-primary hover:bg-primary/90 text-background rounded-lg font-medium transition-colors"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                ) : editedConfig && (
                                    <>
                                        <div className="space-y-4">
                                            {/* Primary Settings */}
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-text-muted flex items-center">
                                                    AI Model
                                                    <Tooltip text="Flash: Fast, 30 RPM limit. Pro: Smarter, 60 RPM limit. Use Pro for large documents (50+ pages) to avoid rate limits." />
                                                </label>
                                                <select
                                                    value={editedConfig.gemini_model}
                                                    onChange={(e) => updateField('gemini_model', e.target.value)}
                                                    className="w-full bg-background border border-border rounded-lg py-2.5 px-4 text-text-main focus:ring-2 focus:ring-primary/50 outline-none appearance-none cursor-pointer"
                                                >
                                                    <option value="gemini-3-flash">Gemini 3 Flash (Fast)</option>
                                                    <option value="gemini-3-pro">Gemini 3 Pro (Smart)</option>
                                                </select>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-text-muted flex items-center">
                                                    Update API Key
                                                    <Tooltip text="Your Google Gemini API Key. Stored securely in your system keychain." />
                                                </label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="password"
                                                        value={newKey}
                                                        onChange={(e) => setNewKey(e.target.value)}
                                                        placeholder="Enter new Gemini API Key"
                                                        className="flex-1 bg-background border border-border rounded-lg py-2.5 px-4 text-text-main focus:ring-2 focus:ring-primary/50 outline-none placeholder:text-text-muted"
                                                    />
                                                    <button
                                                        onClick={handleSaveKey}
                                                        disabled={!newKey.trim() || isSaving}
                                                        className="px-4 py-2 bg-surface hover:bg-surface/80 disabled:opacity-50 disabled:cursor-not-allowed text-text-main rounded-lg font-medium transition-colors text-sm border border-border"
                                                    >
                                                        {isSaving ? 'Saving...' : 'Update'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Advanced Toggle */}
                                            <div className="pt-2">
                                                <button
                                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                                    className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-primary transition-colors uppercase tracking-wider"
                                                >
                                                    {showAdvanced ? (
                                                        <>Hide Advanced <ChevronUp className="w-3 h-3" /></>
                                                    ) : (
                                                        <>Show Advanced <ChevronDown className="w-3 h-3" /></>
                                                    )}
                                                </button>
                                            </div>

                                            {/* Advanced Settings */}
                                            <AnimatePresence>
                                                {showAdvanced && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        className="space-y-4 overflow-hidden"
                                                    >
                                                        <div className="space-y-2 pt-2">
                                                            <label className="text-sm font-medium text-text-muted flex items-center">
                                                                Anki Connect URL
                                                                <Tooltip text="The address where AnkiConnect is listening. Default: http://localhost:8765" />
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={editedConfig.anki_url}
                                                                onChange={(e) => updateField('anki_url', e.target.value)}
                                                                className="w-full bg-background border border-border rounded-lg py-2.5 px-4 text-text-main focus:ring-2 focus:ring-primary/50 outline-none font-mono text-sm"
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="space-y-2">
                                                                <label className="text-sm font-medium text-text-muted flex items-center">
                                                                    Basic Note Type
                                                                    <Tooltip text="The Anki note type used for Basic (Front/Back) cards." />
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={editedConfig.basic_model}
                                                                    onChange={(e) => updateField('basic_model', e.target.value)}
                                                                    className="w-full bg-background border border-border rounded-lg py-2.5 px-4 text-text-main focus:ring-2 focus:ring-primary/50 outline-none"
                                                                />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <label className="text-sm font-medium text-text-muted flex items-center">
                                                                    Cloze Note Type
                                                                    <Tooltip text="The Anki note type used for Cloze Deletion cards." />
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={editedConfig.cloze_model}
                                                                    onChange={(e) => updateField('cloze_model', e.target.value)}
                                                                    className="w-full bg-background border border-border rounded-lg py-2.5 px-4 text-text-main focus:ring-2 focus:ring-primary/50 outline-none"
                                                                />
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>

                                        <div className="w-full h-px bg-border my-4" />

                                        {/* About Section */}
                                        <div className="space-y-4">
                                            <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                                                About
                                            </label>

                                            <div className="p-4 rounded-xl border border-border bg-background space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <p className="text-sm font-semibold text-text-main">Lectern</p>
                                                        <p className="text-xs text-text-muted">Version {versionInfo?.current || '...'}</p>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            checkUpdates();
                                                        }}
                                                        disabled={checkLoading}
                                                        className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors disabled:opacity-50"
                                                        title="Check for updates"
                                                    >
                                                        <RefreshCw className={`w-4 h-4 ${checkLoading ? 'animate-spin' : ''}`} />
                                                    </button>
                                                </div>

                                                {versionInfo?.update_available ? (
                                                    <motion.div
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between gap-4"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                                                                <Download className="w-4 h-4 text-primary" />
                                                            </div>
                                                            <div className="space-y-0.5">
                                                                <p className="text-sm font-medium text-text-main">Update available!</p>
                                                                <p className="text-xs text-text-muted">New version v{versionInfo.latest}</p>
                                                            </div>
                                                        </div>
                                                        <a
                                                            href={versionInfo.release_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-background rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                                                        >
                                                            Download <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    </motion.div>
                                                ) : versionInfo?.latest && (
                                                    <p className="text-[10px] text-text-muted text-center italic">
                                                        You are running the latest version
                                                    </p>
                                                )}

                                                <div className="pt-2 flex items-center justify-center gap-4 text-[10px] text-text-muted">
                                                    <a href="https://github.com/stegra05/Lectern" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub Repository</a>
                                                    <span>•</span>
                                                    <a href="https://github.com/stegra05/Lectern/issues" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Report Issue</a>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="p-6 border-t border-border bg-surface/50 shrink-0">
                                {hasChanges ? (
                                    <button
                                        onClick={handleSaveSettings}
                                        disabled={isSaving}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-background rounded-lg font-medium transition-colors"
                                    >
                                        <Save className="w-4 h-4" />
                                        {isSaving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                ) : saveSuccess ? (
                                    <p className="text-sm text-primary text-center font-medium">
                                        ✓ Settings saved successfully
                                    </p>
                                ) : (
                                    <p className="text-sm text-text-muted text-center">
                                        Edit fields above to save changes
                                    </p>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
