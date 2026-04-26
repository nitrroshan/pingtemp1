/**
 * uiStore — Navigation & layout state shared across components.
 *
 * Extracted from App.tsx to eliminate prop drilling of:
 * - selectedTeamId (used by 8+ components)
 * - activeAgentId (used by Sidebar, ChatArea, DetailPanel)
 * - selectedTaskId (drilled to 6 components)
 * - viewMode, theme
 */

import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';

interface UiState {
  // Navigation
  selectedTeamId: string | null;
  activeAgentId: string;
  selectedTaskId: string | null;
  viewMode: 'chat' | 'tasks' | 'collaborate';

  // Theme
  theme: 'dark' | 'light';

  // Actions
  setSelectedTeamId: (id: string | null) => void;
  setActiveAgentId: (id: string) => void;
  setSelectedTaskId: (id: string | null) => void;
  setViewMode: (mode: 'chat' | 'tasks' | 'collaborate') => void;
  toggleTheme: () => void;
}

export const useUiStore = create<UiState>()(
  devtools(
    persist(
      (set) => ({
        selectedTeamId: null,
        activeAgentId: localStorage.getItem('ping:activeTeamId') || '',
        selectedTaskId: null,
        viewMode: 'chat',
        theme: (localStorage.getItem('ping:theme') as 'dark' | 'light') || 'dark',

        setSelectedTeamId: (id) => {
          set({ selectedTeamId: id });
          if (id) localStorage.setItem('ping:activeTeamId', id);
        },
        setActiveAgentId: (id) => set({ activeAgentId: id }),
        setSelectedTaskId: (id) => set({ selectedTaskId: id }),
        setViewMode: (mode) => set({ viewMode: mode }),
        toggleTheme: () =>
          set((s) => {
            const next = s.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('ping:theme', next);
            return { theme: next };
          }),
      }),
      {
        name: 'ping:ui',
        partialize: (s) => ({ theme: s.theme, viewMode: s.viewMode }),
      },
    ),
    { name: 'UiStore' },
  ),
);
