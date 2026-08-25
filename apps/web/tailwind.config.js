/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#0a0a0f',
          raised: '#11121a',
          edge: '#1a1c28',
        },
        accent: {
          DEFAULT: '#7c5cff',
          soft: '#a78bfa',
          deep: '#4c1d95',
        },
        ink: {
          DEFAULT: '#e9e8f2',
          dim: '#9b9ab1',
          faint: '#5d5c75',
        },
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124, 92, 255, 0.25), 0 8px 32px -8px rgba(124, 92, 255, 0.35)',
        card: '0 8px 32px -12px rgba(0, 0, 0, 0.6)',
      },
      backgroundImage: {
        'mesh-glow':
          'radial-gradient(at 20% 10%, rgba(124, 92, 255, 0.18) 0px, transparent 50%), radial-gradient(at 80% 70%, rgba(167, 139, 250, 0.12) 0px, transparent 50%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};
