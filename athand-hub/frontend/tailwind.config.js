/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base:    'rgb(var(--c-page) / <alpha-value>)',
        page:    'rgb(var(--c-page) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised:  'rgb(var(--c-raised) / <alpha-value>)',
        bd:         'rgb(var(--c-bd) / <alpha-value>)',
        'bd-strong': 'rgb(var(--c-bd-strong) / <alpha-value>)',
        'bd-muted':  'rgb(var(--c-bd-muted) / <alpha-value>)',
        tx:          'rgb(var(--c-tx) / <alpha-value>)',
        'tx-sub':    'rgb(var(--c-tx-sub) / <alpha-value>)',
        'tx-muted':  'rgb(var(--c-tx-muted) / <alpha-value>)',
        'tx-faint':  'rgb(var(--c-tx-faint) / <alpha-value>)',
        'tx-faintest': 'rgb(var(--c-tx-faintest) / <alpha-value>)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
