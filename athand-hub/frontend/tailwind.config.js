/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'rgb(var(--c-page) / <alpha-value>)',
        page: 'rgb(var(--c-page) / <alpha-value>)',
        'page-soft': 'rgb(var(--c-page-soft) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--c-surface-elevated) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        bd: 'rgb(var(--c-bd) / <alpha-value>)',
        'bd-strong': 'rgb(var(--c-bd-strong) / <alpha-value>)',
        'bd-muted': 'rgb(var(--c-bd-muted) / <alpha-value>)',
        tx: 'rgb(var(--c-tx) / <alpha-value>)',
        'tx-sub': 'rgb(var(--c-tx-sub) / <alpha-value>)',
        'tx-muted': 'rgb(var(--c-tx-muted) / <alpha-value>)',
        'tx-faint': 'rgb(var(--c-tx-faint) / <alpha-value>)',
        'tx-faintest': 'rgb(var(--c-tx-faintest) / <alpha-value>)',
        brand: 'rgb(var(--c-brand) / <alpha-value>)',
        'brand-soft': 'rgb(var(--c-brand-soft) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-strong': 'rgb(var(--c-accent-strong) / <alpha-value>)',
        'accent-soft': 'rgb(var(--c-accent-soft) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
      },
      boxShadow: {
        ambient: '0 20px 45px -24px rgb(var(--c-shadow) / 0.45)',
        float: '0 18px 36px -24px rgb(var(--c-shadow) / 0.35)',
        inset: 'inset 0 1px 0 rgb(255 255 255 / 0.04)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.35rem',
        '3xl': '1.8rem',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
