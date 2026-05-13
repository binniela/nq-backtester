import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        panel: "var(--panel)",
        "panel-muted": "var(--panel-muted)",
        line: "var(--line)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        gold: "var(--gold)",
        "ink-soft": "var(--ink-soft)",
        "ops-bg": "var(--ops-bg)",
        "ops-panel": "var(--ops-panel)",
        "ops-surface": "var(--ops-surface)",
        "ops-border": "var(--ops-border)",
        "ops-text": "var(--ops-text)",
        "ops-muted": "var(--ops-muted)",
        "ops-info": "var(--ops-info)",
        "ops-success": "var(--ops-success)",
        "ops-warning": "var(--ops-warning)",
        "ops-danger": "var(--ops-danger)",
        "ops-trading": "var(--ops-trading)",
      },
      boxShadow: {
        soft: "0 22px 70px rgba(0, 0, 0, 0.35)",
        signal: "0 0 34px rgba(88, 166, 255, 0.18)",
      },
    },
  },
  plugins: [],
};
export default config;
