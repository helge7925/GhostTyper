/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0a0a0f',
          card: '#16161f',
          input: '#1e1e2e',
        },
        accent: {
          purple: '#6c5ce7',
          cyan: '#00cec9',
          green: '#00b894',
          yellow: '#fdcb6e',
          red: '#ff6b6b',
        },
        text: {
          primary: '#e8e8ed',
          secondary: '#8b8b9e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
