/**
 * NotificationChip — Inline task/plan lifecycle chips
 *
 * Renders inside a message stream when task-started, task-completed,
 * task-failed, plan-proposed, or plan-approved events arrive.
 */

import React from 'react';
import { CheckCircle, XCircle, Clock, FileText, Zap } from 'lucide-react';
import type { NotificationChipState } from '../types';

interface NotificationChipProps {
  chip: NotificationChipState;
}

const chipConfig: Record<string, {
  icon: React.ReactNode;
  bg: string;
  text: string;
  label: (chip: NotificationChipState) => string;
}> = {
  'task-started': {
    icon: <Clock size={11} />,
    bg: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300',
    text: 'text-blue-700 dark:text-blue-300',
    label: (c) => `Task started${c.role ? ` · ${c.role}` : ''}`,
  },
  'task-completed': {
    icon: <CheckCircle size={11} />,
    bg: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
    label: (c) => `Task completed${c.role ? ` · ${c.role}` : ''}`,
  },
  'task-failed': {
    icon: <XCircle size={11} />,
    bg: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300',
    text: 'text-red-700 dark:text-red-300',
    label: (c) => `Task failed${c.error ? ` · ${c.error.slice(0, 40)}` : ''}`,
  },
  'plan-proposed': {
    icon: <FileText size={11} />,
    bg: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-300',
    label: () => 'Plan proposed — awaiting approval',
  },
  'plan-approved': {
    icon: <Zap size={11} />,
    bg: 'bg-primary/10 border-primary/30 text-primary',
    text: 'text-primary',
    label: () => 'Plan approved — executing',
  },
};

const NotificationChip: React.FC<NotificationChipProps> = ({ chip }) => {
  const cfg = chipConfig[chip.type];
  if (!cfg) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium my-0.5 ${cfg.bg}`}>
      {cfg.icon}
      <span>{cfg.label(chip)}</span>
    </div>
  );
};

export default NotificationChip;
