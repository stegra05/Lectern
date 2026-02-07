import { useState, useEffect } from 'react';
import { api } from '../api';

export type Step = 'dashboard' | 'config' | 'generating' | 'done';

export interface HealthStatus {
  anki_connected: boolean;
  gemini_configured: boolean;
  anki_version?: string;
  gemini_model?: string;
}

export function useAppState() {
  const [step, setStep] = useState<Step>('dashboard');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const refreshHealth = async () => {
    setIsRefreshingStatus(true);
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
      setIsRefreshingStatus(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.anki_connected, health?.gemini_configured]);

  return {
    step,
    setStep,
    health,
    setHealth,
    showOnboarding,
    setShowOnboarding,
    isCheckingHealth,
    isSettingsOpen,
    setIsSettingsOpen,
    isHistoryOpen,
    setIsHistoryOpen,
    theme,
    toggleTheme,
    isRefreshingStatus,
    refreshHealth
  };
}
