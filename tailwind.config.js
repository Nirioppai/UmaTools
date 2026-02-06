const animatePlugin = (() => {
  try {
    return require("tailwindcss-animate");
  } catch (err) {
    return require("./scripts/tailwindcss-animate");
  }
})();

module.exports = {
  content: ["./*.html", "./js/**/*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--color-surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--color-surface-3) / <alpha-value>)",
        "surface-1": "rgb(var(--surface-1-rgb) / <alpha-value>)",
        "surface-2-alt": "rgb(var(--surface-2-rgb) / <alpha-value>)",
        "surface-3-alt": "rgb(var(--surface-3-rgb) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        text: "rgb(var(--color-text) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        "text-1": "rgb(var(--text-1-rgb) / <alpha-value>)",
        "text-2": "rgb(var(--text-2-rgb) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          foreground: "rgb(var(--color-primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--color-secondary) / <alpha-value>)",
          foreground: "rgb(var(--color-secondary-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          foreground: "rgb(var(--color-accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive-rgb) / <alpha-value>)",
          foreground: "rgb(var(--destructive-foreground-rgb) / <alpha-value>)",
        },
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
        ring: "rgb(var(--color-ring) / <alpha-value>)",
        "pill-bg": "rgb(var(--pill-bg-rgb) / <alpha-value>)",
        "pill-text": "rgb(var(--pill-text-rgb) / <alpha-value>)",
        "table-hover": "rgb(var(--table-hover-rgb) / <alpha-value>)",
        "table-selected": "rgb(var(--table-selected-rgb) / <alpha-value>)",
        "chart-1": "rgb(var(--color-chart-1) / <alpha-value>)",
        "chart-2": "rgb(var(--color-chart-2) / <alpha-value>)",
        "chart-3": "rgb(var(--color-chart-3) / <alpha-value>)",
        "chart-4": "rgb(var(--color-chart-4) / <alpha-value>)",
        "chart-5": "rgb(var(--color-chart-5) / <alpha-value>)",
      },
      borderRadius: {
        sm: "calc(var(--radius) - 6px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 6px)",
      },
      boxShadow: {
        card: "0 18px 40px -24px rgb(var(--shadow-color) / 0.45)",
        glow: "0 0 28px rgb(var(--color-accent) / 0.35)",
        inset: "inset 0 1px 0 rgb(255 255 255 / 0.3)",
      },
      ringOffsetColor: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s ease-out both",
        shimmer: "shimmer 1.8s linear infinite",
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/aspect-ratio"),
    animatePlugin,
  ],
};
