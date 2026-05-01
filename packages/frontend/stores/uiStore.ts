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
  viewMode: 'chat' | 'tasks' | 'collaborate';

  // Theme
  theme: 'dark' | 'light';

  // Layout toggles
  isPanelOpen: boolean;
  isSidebarExpanded: boolean;
  isMobileSidebarOpen: boolean;
  isCommandPaletteOpen: boolean;
  activeMenu: string | null;

  // Modal
  isModalOpen: boolean;
  modalParentId: string | undefined;

  // Actions
  setSelectedTeamId: (id: string | null) => void;
  setActiveAgentId: (id: string) => void;
  setViewMode: (mode: 'chat' | 'tasks' | 'collaborate') => void;
  toggleTheme: () => void;
  setIsPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  setIsMobileSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setActiveMenu: (menu: string | null) => void;
  openModal: (parentId?: string) => void;
  closeModal: () => void;
}

export const useUiStore = create<UiState>()(
  devtools(
    persist(
      (set) => ({
        selectedTeamId: null,
        activeAgentId: '',
        viewMode: 'chat',
        theme: 'dark',

        isPanelOpen: false,
        isSidebarExpanded: true,
        isMobileSidebarOpen: false,
        isCommandPaletteOpen: false,
        activeMenu: null,

        isModalOpen: false,
        modalParentId: undefined,

        setSelectedTeamId: (id) => set({ selectedTeamId: id }),
        setActiveAgentId: (id) => set({ activeAgentId: id }),
        setViewMode: (mode) => set({ viewMode: mode }),
        toggleTheme: () =>
          set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
        setIsPanelOpen: (open) =>
          set((s) => ({ isPanelOpen: typeof open === 'function' ? open(s.isPanelOpen) : open })),
        toggleSidebar: () => set((s) => ({ isSidebarExpanded: !s.isSidebarExpanded })),
        setIsMobileSidebarOpen: (open) =>
          set((s) => ({ isMobileSidebarOpen: typeof open === 'function' ? open(s.isMobileSidebarOpen) : open })),
        setIsCommandPaletteOpen: (open) =>
          set((s) => ({ isCommandPaletteOpen: typeof open === 'function' ? open(s.isCommandPaletteOpen) : open })),
        setActiveMenu: (menu) => set({ activeMenu: menu }),
        openModal: (parentId) => set({ isModalOpen: true, modalParentId: parentId }),
        closeModal: () => set({ isModalOpen: false, modalParentId: undefined }),
      }),
      {
        name: 'ping:ui',
        version: 3, // v3: removed goal-scoped fields (now in goalSessionStore)
        partialize: (s) => ({
          theme: s.theme,
          viewMode: s.viewMode,
          isSidebarExpanded: s.isSidebarExpanded,
        }),
      },
    ),
    { name: 'UiStore' },
  ),
);
