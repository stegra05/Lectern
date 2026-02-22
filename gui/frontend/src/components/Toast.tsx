import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle, Undo2 } from 'lucide-react';

import { twMerge } from 'tailwind-merge';

/**
 * Maps toast types to their appropriate ARIA roles.
 * - 'success' and 'info' use role="status" (polite announcements)
 * - 'error' and 'warning' use role="alert" (assertive announcements)
 */
const getAriaRole = (type: ToastType): 'status' | 'alert' => {
    if (type === 'error' || type === 'warning') {
        return 'alert';
    }
    return 'status';
};

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  /** Optional undo action callback */
  onUndo?: () => void;
  undoLabel?: string;
}

interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
}

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors = {
  success: 'text-green-400 bg-green-500/10 border-green-500/20',
  error: 'text-red-400 bg-red-500/10 border-red-500/20',
  warning: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

export const Toast: React.FC<ToastProps> = ({ id, type, message, duration = 5000, onUndo, undoLabel, onDismiss }) => {
  const Icon = icons[type];
  const ariaRole = getAriaRole(type);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      role={ariaRole}
      aria-live={ariaRole === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={twMerge(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border p-4 shadow-lg backdrop-blur-xl",
        colors[type]
      )}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 text-sm font-medium leading-tight text-text-main/90">
        {message}
      </div>
      {onUndo && (
        <button
          onClick={() => {
            onUndo();
            onDismiss(id);
          }}
          className="flex items-center gap-1.5 px-2 py-1 -my-1 rounded-md bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors shrink-0"
        >
          <Undo2 className="h-3 w-3" />
          {undoLabel || 'Undo'}
        </button>
      )}
      <button
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-black/5 transition-opacity"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.div>
  );
};

export const ToastContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 pointer-events-none p-4">
      <AnimatePresence mode="popLayout">
        {children}
      </AnimatePresence>
    </div>
  );
};
