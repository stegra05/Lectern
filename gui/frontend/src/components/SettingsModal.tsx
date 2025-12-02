import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { api } from '../api';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newKey, setNewKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const loadConfig = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getConfig();
            setConfig(data);
            setNewKey(''); // Reset input
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
            await loadConfig(); // Reload to confirm
            setNewKey('');
        } catch (err) {
            console.error(err);
            setError('Failed to save key');
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadConfig();
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
                        <div className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-2xl shadow-2xl pointer-events-auto overflow-hidden">
                            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                                <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-primary" />
                                    Settings
                                </h2>
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                {loading ? (
                                    <div className="flex justify-center py-8">
                                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : error ? (
                                    <div className="py-8 text-center space-y-4">
                                        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
                                        <p className="text-zinc-400">{error}</p>
                                        <button
                                            onClick={loadConfig}
                                            className="px-4 py-2 bg-primary hover:bg-primary/90 text-zinc-900 rounded-lg font-medium transition-colors"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-zinc-400">Gemini Model</label>
                                            <input
                                                type="text"
                                                value={config?.gemini_model || ''}
                                                readOnly
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-4 text-zinc-300 focus:ring-2 focus:ring-primary/50 outline-none opacity-60 cursor-not-allowed"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-zinc-400">Update API Key</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="password"
                                                    value={newKey}
                                                    onChange={(e) => setNewKey(e.target.value)}
                                                    placeholder="Enter new Gemini API Key"
                                                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-4 text-zinc-300 focus:ring-2 focus:ring-primary/50 outline-none placeholder:text-zinc-700"
                                                />
                                                <button
                                                    onClick={handleSaveKey}
                                                    disabled={!newKey.trim() || isSaving}
                                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 rounded-lg font-medium transition-colors text-sm"
                                                >
                                                    {isSaving ? 'Saving...' : 'Update'}
                                                </button>
                                            </div>
                                            <p className="text-xs text-zinc-500">Securely stored in system keychain</p>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-zinc-400">Anki Connect URL</label>
                                            <input
                                                type="text"
                                                value={config?.anki_url || ''}
                                                readOnly
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-4 text-zinc-300 focus:ring-2 focus:ring-primary/50 outline-none opacity-60 cursor-not-allowed"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-zinc-400">Basic Model</label>
                                                <input
                                                    type="text"
                                                    value={config?.basic_model || ''}
                                                    readOnly
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-4 text-zinc-300 opacity-60 cursor-not-allowed"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-zinc-400">Cloze Model</label>
                                                <input
                                                    type="text"
                                                    value={config?.cloze_model || ''}
                                                    readOnly
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-4 text-zinc-300 opacity-60 cursor-not-allowed"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="p-6 border-t border-zinc-800 bg-zinc-900/50">
                                <p className="text-sm text-zinc-500 text-center">
                                    Other settings are configured via environment variables.
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
