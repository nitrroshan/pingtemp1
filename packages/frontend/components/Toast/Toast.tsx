/**
 * Toast — lightweight notification system
 *
 * Usage:
 *   const { toasts, showToast, dismissToast } = useToast();
 *   <ToastContainer toasts={toasts} onDismiss={dismissToast} />
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, 0 = permanent
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((
    message: string,
    type: ToastType = 'info',
    duration = 4000,
  ) => {
    const id = uuidv4();
    const toast: Toast = { id, type, message, duration };
    setToasts(prev => [...prev.slice(-4), toast]); // max 5 toasts

    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }

    return id;
  }, [dismissToast]);

  return { toasts, showToast, dismissToast };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => string;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => '',
});

export const useToastContext = () => useContext(ToastContext);

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastType, string> = {
  success: 'bg-teal-900/90 border-teal-700/60 text-teal-100',
  error: 'bg-red-900/90 border-red-700/60 text-red-100',
  warning: 'bg-orange-900/90 border-orange-700/60 text-orange-100',
  info: 'bg-nexus-800/90 border-nexus-700/60 text-slate-100',
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const Icon = ICONS[toast.type];
  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl
        backdrop-blur-sm text-sm max-w-sm pointer-events-auto
        animate-in slide-in-from-right-full fade-in duration-200
        ${STYLES[toast.type]}
      `}
    >
      <Icon size={16} className="flex-shrink-0 mt-0.5" />
      <p className="flex-1 leading-relaxed">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity p-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const { toasts, showToast, dismissToast } = useToast();

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};
