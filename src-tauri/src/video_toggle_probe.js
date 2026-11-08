(() => {
  const runtime = window.__ytmFeatures;
  if (!runtime) return;

  const BUTTON_ID = "ytm-player-av-toggle-btn";
  const STYLE_ID = "ytm-tauri-video-toggle-style";
  const LABEL_CLASS = "ytm-av-toggle-label";
  const AUDIO_CLASS = "ytm-visual-audio-mode";
  const PENDING_CLASS = "ytm-av-toggle-pending";
  const MODE_KEY = "ytm_visual_audio_mode";

  const css = `
    #${BUTTON_ID} {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      height: 32px !important;
      min-width: 0 !important;
      padding: 0 10px !important;
      margin: 0 4px !important;
      border: 1px solid rgba(255, 255, 255, 0.16) !important;
      border-radius: 16px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      color: #fff !important;
      font: 600 11px/1 "YouTube Sans", "Roboto", system-ui, sans-serif !important;
      cursor: pointer !important;
      flex-shrink: 0 !important;
      white-space: nowrap !important;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease !important;
    }
    #${BUTTON_ID}:hover {
      background: rgba(255, 255, 255, 0.16) !important;
      border-color: rgba(255, 255, 255, 0.28) !important;
    }
    #${BUTTON_ID}:active {
      transform: scale(0.96) !important;
    }
    #${BUTTON_ID}.${PENDING_CLASS} {
      opacity: 0.6 !important;
    }
    #${BUTTON_ID} svg {
      width: 16px !important;
      height: 16px !important;
      fill: currentColor !important;
      flex-shrink: 0 !important;
    }
    #${BUTTON_ID} .${LABEL_CLASS} {
      display: inline-block !important;
    }

    /*
     * Accounts without native AV switching (for example YouTube Music
     * without Premium) still get a useful audio view: the video stream keeps
     * playing, but the player shows a square album-art panel instead of the
     * video. The native layout is restored as soon as the mode is toggled off.
     */
    #player.${AUDIO_CLASS} {
      height: 100% !important;
      width: auto !important;
      aspect-ratio: 1 / 1 !important;
      flex: 0 0 auto !important;
      border-radius: 8px !important;
      overflow: hidden !important;
    }
    #player.${AUDIO_CLASS} #song-video {
      display: none !important;
    }
    #player.${AUDIO_CLASS} #song-image {
      display: block !important;
      padding-top: 0 !important;
      height: 100% !important;
      width: 100% !important;
    }
    #player.${AUDIO_CLASS} #song-image #thumbnail {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
    }
    #player.${AUDIO_CLASS} #song-image #thumbnail img {
      object-fit: cover !important;
      width: 100% !important;
      height: 100% !important;
    }
    #player.${AUDIO_CLASS} #song-image img.html5-blur-image {
      display: none !important;
    }
  `;

  const ICON_PATHS = {
    video:
      "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
    audio:
      "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  };

  let interval = 0;
  let listening = false;
  let visualAudioMode = false;
  let lastVideoId = "";

  try {
    visualAudioMode = window.sessionStorage?.getItem(MODE_KEY) === "1";
  } catch {}

  function persistMode() {
    try {
      window.sessionStorage?.setItem(MODE_KEY, visualAudioMode ? "1" : "0");
    } catch {}
  }

  function playerElement() {
    return document.querySelector("#player");
  }

  function nativeToggle() {
    return document.querySelector("ytmusic-av-toggle");
  }

  function nativeButtons() {
    return {
      video: document.querySelector(".video-button.ytmusic-av-toggle"),
      song: document.querySelector(".song-button.ytmusic-av-toggle"),
    };
  }

  function nativePlaybackMode() {
    const host = nativeToggle();
    if (host && typeof host.playbackMode === "string") return host.playbackMode;
    const player = playerElement();
    if (player && typeof player.playbackMode === "string") return player.playbackMode;
    const { video, song } = nativeButtons();
    if (video?.getAttribute?.("aria-pressed") === "true") return "OMV_PREFERRED";
    if (song?.getAttribute?.("aria-pressed") === "true") return "ATV_PREFERRED";
    return "";
  }

  function nativeToggleDisabled() {
    const host = nativeToggle();
    if (!host) return true;
    if (host.toggleDisabled === true) return true;
    return host.hasAttribute?.("toggle-disabled") === true;
  }

  function hasVideo() {
    const player = playerElement();
    if (player && typeof player.videoMode === "boolean") return player.videoMode;
    const { video } = nativeButtons();
    return video?.getAttribute?.("aria-pressed") === "true";
  }

  function isAdPlaying() {
    const player = playerElement();
    if (!player) return false;
    if (player.adPlaying === true) return true;
    return player.hasAttribute?.("is-advertisement-playing") === true;
  }

  function isPlayerPageOpen() {
    const player = playerElement();
    if (!player) return false;
    return (
      player.hasAttribute?.("player-page-open") === true ||
      player.getAttribute?.("player-ui-state") === "PLAYER_PAGE_OPEN"
    );
  }

  function isVideoMode() {
    if (visualAudioMode && hasVideo()) return false;
    const mode = nativePlaybackMode();
    if (mode === "ATV_PREFERRED") return false;
    if (mode === "OMV_PREFERRED") return true;
    const { video } = nativeButtons();
    if (video?.getAttribute?.("aria-pressed") === "true") return true;
    const player = playerElement();
    return Boolean(player?.hasAttribute?.("video-mode"));
  }

  function canToggle() {
    if (hasVideo()) return true;
    const host = nativeToggle();
    if (!host) return false;
    if (nativeToggleDisabled()) return false;
    return (
      host.selectedItemHasVideo === true ||
      host.hasAttribute?.("selected-item-has-video") === true
    );
  }

  function thumbnailUrl() {
    const player = playerElement();
    const thumbs = player?.playerResponse?.videoDetails?.thumbnail?.thumbnails;
    if (!Array.isArray(thumbs) || !thumbs.length) return "";
    let best = null;
    for (const thumb of thumbs) {
      if (!thumb?.url) continue;
      if (!best || (thumb.width || 0) > (best.width || 0)) best = thumb;
    }
    return best?.url || "";
  }

  function applyThumbnail() {
    const url = thumbnailUrl();
    if (!url) return;
    const thumbnail = document.querySelector("#song-image #thumbnail");
    const image = thumbnail?.querySelector?.("img") || thumbnail?.shadowRoot?.querySelector?.("img");
    if (image && image.getAttribute?.("src") !== url) {
      image.setAttribute("src", url);
      image.removeAttribute?.("srcset");
    }
    const blur = document.querySelector("#song-image img.html5-blur-image");
    if (blur && blur.getAttribute?.("src") !== url) {
      blur.setAttribute("src", url);
      blur.removeAttribute?.("srcset");
    }
  }

  function applyVisualMode() {
    const player = playerElement();
    if (!player) return;
    const shouldApply =
      visualAudioMode && hasVideo() && isPlayerPageOpen() && !isAdPlaying();
    player.classList.toggle(AUDIO_CLASS, shouldApply);
    if (shouldApply) applyThumbnail();
  }

  function createIcon(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[kind]);
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
  }

  function renderButton(button) {
    if (!button) return;
    const available = canToggle();
    button.style.display = available ? "inline-flex" : "none";
    if (!available) return;

    const videoMode = isVideoMode();
    const targetKind = videoMode ? "audio" : "video";
    const label = videoMode ? "Аудио" : "Видео";
    const title = videoMode ? "Переключить на аудио" : "Переключить на видео";

    if (button.dataset.kind !== targetKind) {
      button.dataset.kind = targetKind;
      button.textContent = "";
      button.appendChild(createIcon(targetKind));
      const span = document.createElement("span");
      span.className = LABEL_CLASS;
      span.textContent = label;
      button.appendChild(span);
    } else {
      const span = button.querySelector?.(`.${LABEL_CLASS}`);
      if (span && span.textContent !== label) span.textContent = label;
    }
    if (button.title !== title) button.title = title;
    if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
  }

  function toggle(button) {
    if (!canToggle()) return;

    if (!nativeToggleDisabled()) {
      const videoMode = isVideoMode();
      const { video, song } = nativeButtons();
      const target = videoMode ? song : video;
      if (target && target.getAttribute?.("aria-disabled") !== "true") {
        target.click();
        button.classList.add(PENDING_CLASS);
        setTimeout(() => {
          button.classList.remove(PENDING_CLASS);
          ensureButton();
        }, 250);
        return;
      }
    }

    // Fallback for accounts where YouTube Music disables the native AV
    // toggle (for example without Premium). Playback continues from the same
    // stream, but the video surface is replaced with square album art.
    visualAudioMode = !visualAudioMode;
    persistMode();
    applyVisualMode();
    renderButton(button);
  }

  function ensureButton() {
    const bar = document.querySelector("ytmusic-player-bar");
    if (!bar) return null;
    const controls = bar.querySelector(
      "#right-controls .right-controls-buttons, #right-controls, .right-controls-buttons",
    );
    if (!controls) return null;

    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.className = "ytm-av-toggle-btn";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(button);
      });
      const downloadButton = document.getElementById("ytm-player-download-btn");
      controls.insertBefore(button, downloadButton || controls.firstChild);
    }

    const player = playerElement();
    const videoId = player?.playerResponse?.videoDetails?.videoId || "";
    if (videoId !== lastVideoId) {
      lastVideoId = videoId;
      if (visualAudioMode) applyThumbnail();
    }

    applyVisualMode();
    renderButton(button);
    return button;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    const target = document.head || document.documentElement || document.body;
    if (target) target.appendChild(style);
  }

  function start() {
    injectStyles();
    ensureButton();
    if (!listening) {
      document.addEventListener("yt-navigate-finish", ensureButton, true);
      listening = true;
    }
    if (interval) clearInterval(interval);
    interval = setInterval(ensureButton, 1500);
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = 0;
    if (listening) {
      document.removeEventListener?.("yt-navigate-finish", ensureButton, true);
      listening = false;
    }
    playerElement()?.classList.remove(AUDIO_CLASS);
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  runtime.register("video_quick_toggle", { start, stop });
})();
