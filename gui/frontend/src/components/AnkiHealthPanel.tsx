import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, ExternalLink, Settings, Server } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../api';
import { GlassCard } from './GlassCard';

interface AnkiConnectionInfo {
    connected: boolean;
    version: number | null;
    version_ok: boolean;
    error: string | null;
}

interface AnkiHealthPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings?: () => void;
}

export const AnkiHealthPanel: React.FC<AnkiHealthPanelProps> = ({
    isOpen,
    onClose,
    onOpenSettings,
}) => {
    const [status, setStatus] = useState<AnkiConnectionInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);

    const checkStatus = useCallback(async () => {
        setIsLoading(true);
        try {
            const info = await api.getAnkiStatus();
            setStatus(info);
            setLastChecked(new Date());
        } catch (e) {
            setStatus({
                connected: false,
                version: null,
                version_ok: false,
                error: 'Failed to check Anki status',
            });
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            checkStatus();
        }
    }, [isOpen, checkStatus]);

    if (!isOpen) return null;

    const getStatusIcon = () => {
        if (!status) return null;
        if (status.connected && status.version_ok) {
            return <CheckCircle2 className="w-12 h-12 text-green-400" />;
        }
        if (status.connected && !status.version_ok) {
            return <AlertTriangle className="w-12 h-12 text-yellow-400" />;
        }
        return <XCircle className="w-12 h-12 text-red-400" />;
    };

    const getStatusTitle = () => {
        if (!status) return 'Checking...';
        if (status.connected && status.version_ok) return 'Connected';
        if (status.connected && !status.version_ok) return 'Version Warning';
        return 'Not Connected';
    };

    const getStatusColor = () => {
        if (!status) return 'text-text-muted';
        if (status.connected && status.version_ok) return 'text-green-400';
        if (status.connected && !status.version_ok) return 'text-yellow-400';
        return 'text-red-400';
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none p-4"
                    >
                        <GlassCard className="w-full max-w-md pointer-events-auto border-border overflow-hidden">
                            {/* Header */}
                            <div className="p-5 border-b border-border flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-surface rounded-lg border border-border">
                                        <Server className="w-5 h-5 text-primary" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-text-main">AnkiConnect Status</h2>
                                        <p className="text-xs text-text-muted">Connection diagnostics</p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors"
                                >
                                    <XCircle className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-6">
                                {/* Status Display */}
                                <div className="flex flex-col items-center text-center mb-6">
                                    <motion.div
                                        initial={{ scale: 0.8 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 200 }}
                                    >
                                        {getStatusIcon()}
                                    </motion.div>
                                    <h3 className={clsx("text-xl font-bold mt-3", getStatusColor())}>
                                        {getStatusTitle()}
                                    </h3>
                                    {status?.version && (
                                        <p className="text-sm text-text-muted mt-1">
                                            Version {status.version}
                                        </p>
                                    )}
                                </div>

                                {/* Error Message */}
                                {status?.error && (
                                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                        <p className="text-sm text-red-300">{status.error}</p>
                                    </div>
                                )}

                                {/* Version Warning */}
                                {status?.connected && !status?.version_ok && (
                                    <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                        <div className="flex items-start gap-2">
                                            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-sm text-yellow-200 font-medium">Outdated Version</p>
                                                <p className="text-xs text-yellow-300/70 mt-1">
                                                    Your AnkiConnect version ({status.version}) may not support all features.
                                                    Consider updating to version 6 or later.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Troubleshooting Guide */}
                                {!status?.connected && (
                                    <div className="space-y-3 mb-6">
                                        <p className="text-sm font-medium text-text-main">Quick Fixes:</p>

                                        <div className="space-y-2">
                                            <TroubleshootItem
                                                title="Anki not running?"
                                                description="Open Anki and ensure it's running in the background."
                                            />
                                            <TroubleshootItem
                                                title="AnkiConnect not installed?"
                                                description={
                                                    <>
                                                        Install from{' '}
                                                        <a
                                                            href="https://ankiweb.net/shared/info/2055492159"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                                        >
                                                            AnkiWeb <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                        {' '}(Code: 2055492159)
                                                    </>
                                                }
                                            />
                                            <TroubleshootItem
                                                title="Wrong port?"
                                                description="Check the AnkiConnect URL in Settings."
                                                action={
                                                    onOpenSettings && (
                                                        <button
                                                            onClick={() => {
                                                                onClose();
                                                                onOpenSettings();
                                                            }}
                                                            className="text-xs text-primary hover:underline flex items-center gap-1"
                                                        >
                                                            <Settings className="w-3 h-3" />
                                                            Open Settings
                                                        </button>
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Last Checked */}
                                {lastChecked && (
                                    <p className="text-xs text-text-muted text-center mb-4">
                                        Last checked: {lastChecked.toLocaleTimeString()}
                                    </p>
                                )}

                                {/* Actions */}
                                <div className="flex gap-3">
                                    <button
                                        onClick={checkStatus}
                                        disabled={isLoading}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-surface hover:bg-surface/80 border border-border rounded-lg text-sm font-medium text-text-main transition-colors disabled:opacity-50"
                                    >
                                        <RefreshCw className={clsx("w-4 h-4", isLoading && "animate-spin")} />
                                        {isLoading ? 'Checking...' : 'Refresh'}
                                    </button>
                                    <a
                                        href="https://ankiweb.net/shared/info/2055492159"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm font-medium text-primary transition-colors"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        AnkiConnect Page
                                    </a>
                                </div>
                            </div>
                        </GlassCard>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

interface TroubleshootItemProps {
    title: string;
    description: React.ReactNode;
    action?: React.ReactNode;
}

const TroubleshootItem: React.FC<TroubleshootItemProps> = ({ title, description, action }) => (
    <div className="p-3 bg-surface/50 rounded-lg border border-border/50">
        <p className="text-sm font-medium text-text-main">{title}</p>
        <p className="text-xs text-text-muted mt-1">{description}</p>
        {action && <div className="mt-2">{action}</div>}
    </div>
);

export default AnkiHealthPanel;
