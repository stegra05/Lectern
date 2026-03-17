import { useState, useEffect } from 'react';
import { useHealthQuery } from '../queries';

export interface HealthStatus {
  anki_connected: boolean;
  gemini_configured: boolean;
  anki_version?: string;
  gemini_model?: string;
}

export function useAppState() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  // React Query hook for health
  const { data: healthData, isLoading: isCheckingHealth, refetch: refetchHealth } = useHealthQuery();
  const health = healthData ?? null;

  // Derive onboarding state from health during render (no effect)
  const showOnboarding = Boolean(
    health && (!health.anki_connected || !health.gemini_configured)
  );

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
    await refetchHealth();
    setIsRefreshingStatus(false);
  };

  return {
    health,
    showOnboarding,
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
