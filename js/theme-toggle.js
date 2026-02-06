(function () {
  function applyTheme(dark, persist, animate) {
    var root = document.documentElement;

    function setTheme() {
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
      var sun = document.getElementById("iconSun");
      var moon = document.getElementById("iconMoon");
      if (sun && moon) {
        sun.style.display = dark ? "none" : "inline";
        moon.style.display = dark ? "inline" : "none";
      }
    }

    if (animate) {
      root.classList.add("theme-transition");
      var overlay = document.createElement("div");
      overlay.className = "theme-transition-overlay";
      overlay.style.background = dark
        ? "rgba(12, 16, 28, 0.75)"
        : "rgba(248, 250, 252, 0.7)";
      document.body.appendChild(overlay);
      overlay.getBoundingClientRect();
      setTheme();
      requestAnimationFrame(function () {
        overlay.classList.add("is-active");
      });
      window.setTimeout(function () {
        root.classList.remove("theme-transition");
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 240);
    } else {
      setTheme();
    }

    if (persist) {
      try {
        localStorage.setItem("umasearch-darkmode", dark ? "dark" : "light");
      } catch (e) {}
    }
  }

  applyTheme(document.documentElement.classList.contains("dark"), false, false);

  var btn = document.getElementById("modeToggleBtn");
  if (btn)
    btn.addEventListener("click", function () {
      applyTheme(!document.documentElement.classList.contains("dark"), true, true);
    });

  window.addEventListener("storage", function (e) {
    if (e.key === "umasearch-darkmode") {
      applyTheme(e.newValue === "dark", false, true);
    }
  });
})();
