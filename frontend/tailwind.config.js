/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--dm-background)",
        surface: "var(--dm-surface)",
        border: "var(--dm-border)",
        foreground: "var(--dm-foreground)",
        muted: "var(--dm-muted)",
        primary: {
          DEFAULT: "var(--dm-primary)",
          hover: "var(--dm-primary-hover)",
          soft: "var(--dm-primary-soft)",
        },
        accent: {
          blue: "var(--dm-accent-blue)",
          cyan: "var(--dm-accent-cyan)",
          indigo: "var(--dm-accent-indigo)",
        },
        success: "var(--dm-success)",
        warning: "var(--dm-warning)",
        danger: "var(--dm-danger)",
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
}
