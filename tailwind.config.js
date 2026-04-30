/**
 * Tailwind config for GhostTyper.
 *
 * Theme-aware semantic tokens, backed by CSS variables defined in
 * styles/globals.css. Switching <html data-theme="dark"> swaps every
 * surface, text and border to the dark palette.
 *
 * Two flavours:
 *  - Solid colors (canvas, surface, primary, accent, success, ...) —
 *    alpha-aware, work with `bg-accent/20`, `text-primary/60`, etc.
 *  - Static themed surfaces (hover, subtle, overlay, ...) — encode rgba
 *    directly in the variable; no alpha modifier in Tailwind.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--surface-elevated) / <alpha-value>)',

        // Text
        primary: 'rgb(var(--primary) / <alpha-value>)',
        secondary: 'rgb(var(--secondary) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',

        // Brand accent
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          strong: 'rgb(var(--accent-strong) / <alpha-value>)',
        },

        // Semantic states
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',

        // Static themed surfaces / dividers (no alpha modifier)
        'hover-subtle': 'var(--hover-subtle)',
        hover: 'var(--hover)',
        'hover-strong': 'var(--hover-strong)',
        subtle: 'var(--border-subtle)',
        emphasis: 'var(--border-emphasis)',
        overlay: 'var(--overlay)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
