/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0b0d12',
        panel: '#141821',
        panel2: '#1c212d',
        line: '#2a3242',
        accent: '#ff3d6e',
        accent2: '#7c5cff',
        gold: '#ffce4d',
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
