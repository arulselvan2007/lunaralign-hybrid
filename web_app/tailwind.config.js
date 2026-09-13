/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        lunar: {
          950: "#05070d",
          900: "#0b0f19",
          850: "#101626",
          800: "#182238",
          700: "#273654",
          500: "#4f70a8",
          300: "#9db3d9",
          100: "#e3ebfa",
        },
        cyanGlow: {
          DEFAULT: "#00f0ff",
          500: "#00f0ff",
          400: "#38bdf8",
        },
        isro: {
          orange: "#ff6600",
          navy: "#0a192f",
          cyan: "#00e5ff",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "glow-pulse": "glow 2s ease-in-out infinite alternate",
        "spin-slow": "spin 20s linear infinite",
      },
      keyframes: {
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(0, 240, 255, 0.3)" },
          "100%": { boxShadow: "0 0 25px rgba(0, 240, 255, 0.8), 0 0 50px rgba(0, 240, 255, 0.3)" },
        },
      },
    },
  },
  plugins: [],
};
