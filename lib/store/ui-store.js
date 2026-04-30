import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * App-wide UI state.
 *
 * Persisted (across reloads):
 *  - sidebarCollapsed: desktop sidebar narrow mode (icon-only)
 *
 * Ephemeral (in-memory only):
 *  - sidebarOpen:        mobile/tablet sheet open state
 *  - commandPaletteOpen: ⌘K palette open state
 */
export const useUIStore = create(
  persist(
    (set, get) => ({
      sidebarOpen: false,
      sidebarCollapsed: false,
      commandPaletteOpen: false,

      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (value) => set({ sidebarOpen: !!value }),

      collapseSidebar: () => set({ sidebarCollapsed: true }),
      expandSidebar: () => set({ sidebarCollapsed: false }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setCommandPaletteOpen: (value) => set({ commandPaletteOpen: !!value }),
    }),
    {
      name: 'gt:ui',
      storage: createJSONStorage(() =>
        typeof window === 'undefined' ? undefined : window.localStorage,
      ),
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
