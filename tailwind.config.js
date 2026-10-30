/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      colors: {
        bg:           '#0A0A0A',
        surface:      '#141414',
        'surface-2':  '#1A1A1A',
        'surface-hover': '#1F1F1F',
        border:       '#2A2A2A',
        'border-strong': '#333333',
        ink:          '#FFFFFF',
        'ink-2':      '#E0E0E0',
        muted:        '#9A9A9A',
        subtle:       '#6B6B6B',
        hero:         '#F2F2F2',
      },
      borderRadius: {
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        full: '9999px',
      },
      letterSpacing: {
        mono: '0.12em',
        tight: '-0.03em',
      },
    },
  },
  plugins: [],
}
