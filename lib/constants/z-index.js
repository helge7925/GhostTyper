/**
 * Centralized stacking order for the entire app.
 *
 * Use these constants in inline `style={{ zIndex: Z.modal }}` (or via
 * Tailwind arbitrary `z-[var(--z-modal)]` if you set CSS variables).
 *
 * Lower number = further back. Spacing of 10 leaves room for one-off
 * inserts without renumbering.
 */
export const Z = {
  base: 0,
  raised: 10,
  bottomNav: 30,
  topBar: 30,
  sidebar: 40,
  drawerOverlay: 45,
  drawer: 50,
  toast: 60,
  modal: 70,
  commandPalette: 80,
  tooltip: 90,
};
