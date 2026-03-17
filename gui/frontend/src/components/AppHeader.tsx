import { motion } from 'framer-motion';
import { BookOpen, Clock, Settings, Sun, Moon, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppHeaderProps {
    /** Health status from API */
    health: import('../api').HealthStatus | null;
    /** Whether health check is in progress */
    isCheckingHealth: boolean;
    /** Whether health status is being refreshed */
    isRefreshingStatus: boolean;
    /** Current theme */
    theme: 'light' | 'dark';
    /** Handler for logo click (resets app if on progress view) */
    onLogoClick: () => void;
    /** Handler for refresh health click */
    onRefreshHealth: () => void;
    /** Handler for history button click */
    onHistoryClick: () => void;
    /** Handler for settings button click */
    onSettingsClick: () => void;
    /** Handler for theme toggle */
    onThemeToggle: () => void;
    /** Handler for Anki status click */
    onAnkiClick: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusDot = ({ label, active }: { label: string; active: boolean }) => (
    <div className="flex items-center gap-2">
        <div className={clsx(
            "w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]",
            active ? "bg-primary shadow-primary/50" : "bg-red-500 shadow-red-500/50"
        )} />
        <span className={clsx(
            "text-xs font-medium tracking-wide",
            active ? "text-text-main" : "text-text-muted"
        )}>
            {label}
        </span>
    </div>
);

interface HealthStatusProps {
    health: import('../api').HealthStatus | null;
    isChecking: boolean;
    onRefresh: () => void;
    onAnkiClick: () => void;
}

const HealthStatus = ({ health, isChecking, onRefresh, onAnkiClick }: HealthStatusProps) => (
    <div className="flex items-center gap-3 bg-surface/50 px-4 py-2 rounded-full border border-border backdrop-blur-sm">
        <button
            onClick={onAnkiClick}
            className="hover:opacity-80 transition-opacity"
            title="View AnkiConnect status"
            aria-label="View AnkiConnect status"
        >
            <StatusDot label="Anki" active={health?.anki_connected ?? false} />
        </button>
        <div className="w-px h-4 bg-border" />
        <StatusDot label="Gemini" active={health?.gemini_configured ?? false} />
        <button
            onClick={onRefresh}
            disabled={isChecking}
            className="ml-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
            title="Refresh status"
            aria-label="Refresh status"
        >
            <svg className={clsx("w-3 h-3", isChecking && "animate-spin")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
        </button>
    </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppHeader({
    health,
    isCheckingHealth,
    isRefreshingStatus,
    theme,
    onLogoClick,
    onRefreshHealth,
    onHistoryClick,
    onSettingsClick,
    onThemeToggle,
    onAnkiClick,
}: AppHeaderProps) {
    if (isCheckingHealth) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-text-muted text-sm font-mono tracking-wider animate-pulse">INITIALIZING LECTERN...</p>
                </div>
            </div>
        );
    }

    return (
        <header className="mb-8 flex items-center justify-between">
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-col"
            >
                <button
                    onClick={onLogoClick}
                    className="group text-left transition-transform active:scale-95"
                >
                    <h1 className="text-5xl font-bold tracking-tight text-text-main group-hover:text-primary transition-colors">
                        Lectern<span className="text-primary group-hover:text-text-main transition-colors">.</span>
                    </h1>
                    <div className="flex items-center gap-2 mt-2">
                        <BookOpen className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
                        <p className="text-text-muted font-medium tracking-wide group-hover:text-primary/70 transition-colors uppercase text-xs">
                            AI-POWERED ANKI GENERATOR
                        </p>
                    </div>
                </button>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-6"
            >
                <div className="flex items-center gap-3">
                    <HealthStatus
                        health={health}
                        isChecking={isRefreshingStatus}
                        onRefresh={onRefreshHealth}
                        onAnkiClick={onAnkiClick}
                    />
                    <button
                        onClick={onHistoryClick}
                        className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
                        title="Recent Sessions"
                        aria-label="Recent Sessions"
                    >
                        <Clock className="w-5 h-5" />
                    </button>
                    <button
                        onClick={onThemeToggle}
                        className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
                        title="Toggle Theme"
                        aria-label="Toggle Theme"
                    >
                        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button
                        onClick={onSettingsClick}
                        className="p-3 bg-surface/50 hover:bg-surface border border-border rounded-full transition-colors text-text-muted hover:text-primary"
                        title="Settings"
                        aria-label="Settings"
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </motion.div>
        </header>
    );
}
