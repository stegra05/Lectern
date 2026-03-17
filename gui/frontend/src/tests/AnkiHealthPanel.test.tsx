import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnkiHealthPanel } from '../components/AnkiHealthPanel';
import type { AnkiStatus } from '../schemas/api';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
      <div onClick={onClick} className={className} data-testid="motion-div">
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockOnClose = vi.fn();
const mockOnOpenSettings = vi.fn();
const mockOnRefetch = vi.fn();

const connectedStatus: AnkiStatus = {
  status: 'ok',
  connected: true,
  version: '6',
  version_ok: true,
};

const disconnectedStatus: AnkiStatus = {
  status: 'error',
  connected: false,
  version: null,
  version_ok: false,
  error: 'Connection refused',
};

const versionWarningStatus: AnkiStatus = {
  status: 'ok',
  connected: true,
  version: '5',
  version_ok: false,
  error: undefined,
};

function getDefaultProps(overrides: Partial<{
  status: AnkiStatus | undefined;
  isLoading: boolean;
  lastChecked: Date | null;
}> = {}) {
  return {
    isOpen: true,
    onClose: mockOnClose,
    onOpenSettings: mockOnOpenSettings,
    status: connectedStatus,
    isLoading: false,
    onRefetch: mockOnRefetch,
    lastChecked: new Date(),
    ...overrides,
  };
}

describe('AnkiHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Render conditions', () => {
    it('does not render when isOpen is false', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} isOpen={false} />);
      expect(screen.queryByText('AnkiConnect Status')).not.toBeInTheDocument();
    });

    it('renders when isOpen is true', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} />);
      expect(screen.getByText('AnkiConnect Status')).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('shows loading state while checking status', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ status: undefined, isLoading: true })} />);
      expect(screen.getAllByText('Checking...')[0]).toBeInTheDocument();
    });
  });

  describe('Success state', () => {
    it('displays connected status with version', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} />);
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('Version 6')).toBeInTheDocument();
    });

    it('does not show troubleshooting guide when connected', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} />);
      expect(screen.queryByText('Quick Fixes:')).not.toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('displays error state when connection fails', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ status: disconnectedStatus })} />);
      expect(screen.getByText('Not Connected')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });

    it('shows troubleshooting guide when not connected', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ status: { ...disconnectedStatus, error: undefined } })} />);
      expect(screen.getByText('Quick Fixes:')).toBeInTheDocument();
      expect(screen.getByText('Anki not running?')).toBeInTheDocument();
      expect(screen.getByText('AnkiConnect not installed?')).toBeInTheDocument();
    });
  });

  describe('Version warning state', () => {
    it('shows warning when connected with outdated version', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ status: versionWarningStatus })} />);
      expect(screen.getByText('Version Warning')).toBeInTheDocument();
      expect(screen.getByText(/Outdated Version/i)).toBeInTheDocument();
    });
  });

  describe('Refresh button', () => {
    it('calls onRefetch when refresh button is clicked', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} />);
      const refreshButton = screen.getByText('Refresh');
      act(() => {
        fireEvent.click(refreshButton);
      });
      expect(mockOnRefetch).toHaveBeenCalled();
    });

    it('shows loading state during refresh', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ isLoading: true })} />);
      expect(screen.getAllByText('Checking...')[0]).toBeInTheDocument();
    });
  });

  describe('Close functionality', () => {
    it('calls onClose when close button is clicked', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} />);
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find((btn) => btn.querySelector('svg') && btn.className.includes('hover:bg-surface'));
      if (closeButton) {
        act(() => {
          fireEvent.click(closeButton);
        });
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when backdrop is clicked', () => {
      render(<AnkiHealthPanel {...getDefaultProps()} />);
      const backdrop = screen.getAllByTestId('motion-div')[0];
      act(() => {
        fireEvent.click(backdrop);
      });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Settings integration', () => {
    it('shows settings button when onOpenSettings is provided', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ status: disconnectedStatus })} />);
      expect(screen.getByText('Open Settings')).toBeInTheDocument();
    });

    it('calls onClose and onOpenSettings when settings button is clicked', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ status: disconnectedStatus })} />);
      const settingsButton = screen.getByText('Open Settings');
      act(() => {
        fireEvent.click(settingsButton);
      });
      expect(mockOnClose).toHaveBeenCalled();
      expect(mockOnOpenSettings).toHaveBeenCalled();
    });
  });

  describe('Last checked timestamp', () => {
    it('displays last checked time when lastChecked is provided', () => {
      render(<AnkiHealthPanel {...getDefaultProps({ lastChecked: new Date() })} />);
      expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
    });
  });
});
