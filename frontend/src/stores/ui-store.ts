import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * UI store — sidebar, theme, modal visibility. Theme + sidebar preference
 * are persisted across sessions; everything else is ephemeral.
 */

export type Theme = "light" | "dark" | "system";

interface UIState {
  // Persisted
  theme: Theme;
  sidebarCollapsed: boolean;

  // Ephemeral
  commandPaletteOpen: boolean;
  mobileNavOpen: boolean;
  chatbotOpen: boolean;

  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
  setCommandPalette: (open: boolean) => void;
  toggleMobileNav: () => void;
  toggleChatbot: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      mobileNavOpen: false,
      chatbotOpen: false,

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setCommandPalette: (open) => set({ commandPaletteOpen: open }),
      toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
      toggleChatbot: () => set((s) => ({ chatbotOpen: !s.chatbotOpen })),
    }),
    {
      name: "av-inventory-ui",
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme);
      },
    },
  ),
);

/** Applies a theme by toggling the `dark` class on <html>. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", dark);
    return;
  }
  root.classList.toggle("dark", theme === "dark");
}

// Re-apply on system-theme change when in "system" mode.
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useUIStore.getState().theme === "system") applyTheme("system");
  });
}
