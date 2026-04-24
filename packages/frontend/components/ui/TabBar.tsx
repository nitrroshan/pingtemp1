/**
 * TabBar — reusable tab strip component.
 *
 * Used by DetailPanel and DiscussionThread for consistent tab UX.
 * Thin (36px), horizontal, with active indicator.
 */

import React from 'react';
import { cn } from '../../lib/utils';

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab, onTabChange, className }) => {
  return (
    <div className={cn('flex items-center border-b border-border shrink-0 px-1', className)}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-2 text-xs transition-colors cursor-pointer relative',
            activeTab === tab.id
              ? 'text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge != null && tab.badge > 0 && (
            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded-full min-w-[16px] text-center">
              {tab.badge}
            </span>
          )}
          {/* Active indicator */}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
};
