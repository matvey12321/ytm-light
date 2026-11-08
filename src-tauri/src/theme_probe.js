(() => {
  if (typeof location === "object" && location.hostname && location.hostname !== "music.youtube.com") {
    return;
  }
  if (window.__ytmThemeInstalled) return;
  window.__ytmThemeInstalled = true;

  const STYLE_ID = "ytm-light-theme";

  const PRESETS = {
    amoled: `
      html, body, ytmusic-app, ytmusic-app-layout, ytmusic-player-page,
      ytmusic-browse-response, ytmusic-search-page {
        background-color: #000 !important;
      }
      ytmusic-player-bar, #miniplayer-bar {
        background-color: #000 !important;
        border-top-color: rgba(255, 255, 255, 0.08) !important;
      }
    `,
    midnight: `
      html, body, ytmusic-app, ytmusic-app-layout, ytmusic-player-page,
      ytmusic-browse-response, ytmusic-search-page {
        background-color: #0a1020 !important;
      }
      ytmusic-player-bar, #miniplayer-bar {
        background-color: #0d1528 !important;
        border-top-color: rgba(120, 160, 255, 0.16) !important;
      }
    `,
  };

  function buildCss(config) {
    const preset = PRESETS[config?.theme] || "";
    const custom = typeof config?.custom_css === "string" ? config.custom_css : "";
    return `${preset}\n${custom}`.trim();
  }

  function apply(config) {
    let style = document.getElementById(STYLE_ID);
    const css = buildCss(config || {});
    if (!css) {
      if (style) style.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
  }

  function stop() {
    document.getElementById(STYLE_ID)?.remove();
  }

  window.__ytmFeatures?.register("theme", {
    start: apply,
    update: apply,
    stop,
  });
})();
