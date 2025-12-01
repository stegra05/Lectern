/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        background: '#09090b', // Zinc 950
        surface: '#18181b',    // Zinc 900
        primary: '#a3e635',    // Lime 400
        secondary: '#a1a1aa',  // Zinc 400
      }
    },
  },
  plugins: [],
}
