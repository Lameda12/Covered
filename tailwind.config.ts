import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F2EDE3", card: "#FFFDF8", ink: "#121212", mute: "#6f695e", line: "#dcd4c4",
        go: "#0BB35E", "go-deep": "#067a40", go2: "#063d22", hot: "#C73A12", gold: "#E8B520",
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-inter-tight)", "system-ui", "sans-serif"],
      },
    },
  },
} satisfies Config;
