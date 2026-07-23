/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#1a1a1a',
        'content-bg': '#f5f0e8',
        gold: '#C9A84C',
        'gold-light': '#E8C96B',
        'gold-dark': '#A07830',
        charcoal: '#2a2a2a',
        'cat-briefs': '#0D7377',
        'cat-artists': '#4B3F72',
        'cat-presentation': '#7B2D42',
        'cat-new': '#2D6A4F',
        'cat-pencil': '#D4880A',
        'cat-fittings': '#2E6DA4',
        'cat-shoots': '#8B1A1A',
        'cat-unavailable': '#5A6475',
        'cat-roles': '#6B6B2A',
        'cat-calendar': '#4A235A',
        'cat-all': '#7A6435',
      },
    },
  },
  plugins: [],
};
