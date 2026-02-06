const plugin = require("tailwindcss/plugin");

module.exports = plugin(function ({ addBase, addUtilities }) {
  addBase({
    "@keyframes enter": {
      "0%": {
        opacity: "var(--tw-enter-opacity, 1)",
        transform:
          "translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0) scale(var(--tw-enter-scale, 1))",
      },
      "100%": {
        opacity: "1",
        transform: "translate3d(0, 0, 0) scale(1)",
      },
    },
    "@keyframes exit": {
      "0%": {
        opacity: "1",
        transform: "translate3d(0, 0, 0) scale(1)",
      },
      "100%": {
        opacity: "var(--tw-exit-opacity, 1)",
        transform:
          "translate3d(var(--tw-exit-translate-x, 0), var(--tw-exit-translate-y, 0), 0) scale(var(--tw-exit-scale, 1))",
      },
    },
  });

  addUtilities({
    ".animate-in": {
      "animation-name": "enter",
      "animation-duration": "var(--tw-enter-duration, 200ms)",
      "animation-timing-function":
        "var(--tw-enter-ease, cubic-bezier(0.16, 1, 0.3, 1))",
      "animation-fill-mode": "both",
    },
    ".animate-out": {
      "animation-name": "exit",
      "animation-duration": "var(--tw-exit-duration, 150ms)",
      "animation-timing-function":
        "var(--tw-exit-ease, cubic-bezier(0.4, 0, 1, 1))",
      "animation-fill-mode": "both",
    },
    ".fade-in": { "--tw-enter-opacity": "0" },
    ".fade-out": { "--tw-exit-opacity": "0" },
    ".zoom-in-95": { "--tw-enter-scale": "0.95" },
    ".zoom-out-95": { "--tw-exit-scale": "0.95" },
    ".slide-in-from-bottom-4": { "--tw-enter-translate-y": "1rem" },
    ".slide-out-to-bottom-4": { "--tw-exit-translate-y": "1rem" },
    ".slide-in-from-top-2": { "--tw-enter-translate-y": "-0.5rem" },
    ".slide-out-to-top-2": { "--tw-exit-translate-y": "-0.5rem" },
  });
});
