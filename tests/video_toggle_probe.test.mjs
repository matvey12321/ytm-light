import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src-tauri/src/video_toggle_probe.js", import.meta.url), "utf8");

function matches(element, part) {
  if (!part) return false;
  if (part.startsWith("#")) return element.id === part.slice(1);
  if (part.startsWith(".")) {
    const classes = part.slice(1).split(".");
    return classes.every((name) => element.classList.contains(name));
  }
  const [tag, ...classes] = part.split(".");
  return (
    element.tagName === tag.toUpperCase() &&
    classes.every((name) => element.classList.contains(name))
  );
}

function collectDescendants(root, part, out) {
  for (const child of root.children || []) {
    if (matches(child, part)) out.push(child);
    collectDescendants(child, part, out);
  }
}

function find(root, selector) {
  const alternatives = selector
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const alternative of alternatives) {
    const parts = alternative.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    let current = [root];
    for (const part of parts) {
      const next = [];
      for (const node of current) {
        for (const child of node.children || []) {
          if (matches(child, part)) next.push(child);
          collectDescendants(child, part, next);
        }
      }
      current = next;
      if (!current.length) break;
    }
    if (current.length) return current[0];
  }
  return null;
}

function createMockElement(tagName, { id = "", className = "" } = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const children = [];
  let textContent = "";

  const elem = {
    tagName: tagName.toUpperCase(),
    id,
    className,
    style: {},
    dataset: {},
    title: "",
    type: "",
    parentNode: null,
    children,
    attributes,
    videoMode: false,
    playbackMode: "",
    playerResponse: null,
    toggleDisabled: false,
    selectedItemHasVideo: false,
    adPlaying: false,
    get firstChild() {
      return children[0] || null;
    },
    get textContent() {
      return textContent;
    },
    set textContent(value) {
      textContent = String(value);
      if (value === "") children.length = 0;
    },
    classList: {
      add(name) {
        if (!elem.classList.contains(name)) {
          elem.className = `${elem.className} ${name}`.trim();
        }
      },
      remove(name) {
        elem.className = elem.className
          .split(/\s+/)
          .filter((item) => item && item !== name)
          .join(" ");
      },
      contains(name) {
        return elem.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        const shouldAdd =
          force === undefined ? !elem.classList.contains(name) : Boolean(force);
        if (shouldAdd) elem.classList.add(name);
        else elem.classList.remove(name);
        return shouldAdd;
      },
    },
    appendChild(child) {
      child.parentNode = elem;
      children.push(child);
      return child;
    },
    insertBefore(child, reference) {
      child.parentNode = elem;
      const index = children.indexOf(reference);
      if (index === -1) children.push(child);
      else children.splice(index, 0, child);
      return child;
    },
    remove() {
      if (!elem.parentNode) return;
      const index = elem.parentNode.children.indexOf(elem);
      if (index !== -1) elem.parentNode.children.splice(index, 1);
      elem.parentNode = null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === "id") elem.id = String(value);
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      if (!handler) return undefined;
      return handler({ preventDefault() {}, stopPropagation() {}, ...event });
    },
    click() {
      return elem.dispatch("click");
    },
    querySelector(selector) {
      return find(elem, selector);
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
    },
  };

  return elem;
}

function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function createEnv({
  native = false,
  nativeDisabled = false,
  videoMode = true,
  pageOpen = true,
} = {}) {
  const html = createMockElement("html");
  const head = createMockElement("head");
  const body = createMockElement("body");
  html.appendChild(head);
  html.appendChild(body);

  const player = createMockElement("ytmusic-player", { id: "player" });
  player.videoMode = videoMode;
  player.playbackMode = videoMode ? "OMV_PREFERRED" : "ATV_PREFERRED";
  player.playerResponse = {
    videoDetails: {
      videoId: "video-1",
      thumbnail: {
        thumbnails: [
          { url: "https://img.example/small.jpg", width: 320, height: 180 },
          { url: "https://img.example/large.jpg", width: 1280, height: 720 },
        ],
      },
    },
  };
  if (videoMode) player.setAttribute("video-mode", "");
  if (pageOpen) player.setAttribute("player-page-open", "");
  player.setAttribute("player-ui-state", pageOpen ? "PLAYER_PAGE_OPEN" : "PLAYER_BAR_ONLY");
  body.appendChild(player);

  const songImage = createMockElement("div", { id: "song-image" });
  const songVideo = createMockElement("div", { id: "song-video" });
  player.appendChild(songImage);
  player.appendChild(songVideo);

  const thumbnail = createMockElement("yt-img-shadow", { id: "thumbnail" });
  const thumbnailImage = createMockElement("img");
  thumbnail.appendChild(thumbnailImage);
  songImage.appendChild(thumbnail);
  const blurImage = createMockElement("img", { className: "html5-blur-image" });
  songImage.appendChild(blurImage);

  const controls = createMockElement("div", { id: "right-controls" });
  const bar = createMockElement("ytmusic-player-bar");
  bar.appendChild(controls);
  bar.querySelector = (selector) =>
    selector.includes("right-controls") ? controls : find(bar, selector);
  body.appendChild(bar);

  const videoButton = createMockElement("button", {
    className: "video-button ytmusic-av-toggle",
  });
  videoButton.setAttribute("aria-pressed", videoMode ? "true" : "false");
  const songButton = createMockElement("button", {
    className: "song-button ytmusic-av-toggle",
  });
  songButton.setAttribute("aria-pressed", videoMode ? "false" : "true");

  let videoClicks = 0;
  let songClicks = 0;
  videoButton.click = () => {
    videoClicks += 1;
  };
  songButton.click = () => {
    songClicks += 1;
  };

  let nativeHost = null;
  if (native) {
    nativeHost = createMockElement("ytmusic-av-toggle");
    nativeHost.playbackMode = videoMode ? "OMV_PREFERRED" : "ATV_PREFERRED";
    nativeHost.toggleDisabled = nativeDisabled;
    nativeHost.selectedItemHasVideo = true;
    if (nativeDisabled) nativeHost.setAttribute("toggle-disabled", "");
    nativeHost.appendChild(videoButton);
    nativeHost.appendChild(songButton);
    body.appendChild(nativeHost);
  }

  const documentListeners = new Map();
  const storage = new Map();
  const document = {
    readyState: "complete",
    documentElement: html,
    head,
    body,
    createElement(tag) {
      return createMockElement(tag);
    },
    createElementNS(_namespace, tag) {
      return createMockElement(tag);
    },
    getElementById(id) {
      return findById(html, id);
    },
    querySelector(selector) {
      if (selector === "ytmusic-av-toggle") return nativeHost;
      return find(html, selector);
    },
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
    removeEventListener(type) {
      documentListeners.delete(type);
    },
  };

  let registered = null;
  const context = {
    location: { hostname: "music.youtube.com" },
    document,
    sessionStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    window: null,
  };
  context.window = context;
  context.window.__ytmFeatures = {
    register(name, feature) {
      registered = { name, ...feature };
    },
  };

  vm.runInNewContext(source, context);

  return {
    context,
    document,
    body,
    controls,
    player,
    songImage,
    songVideo,
    thumbnailImage,
    blurImage,
    videoButton,
    songButton,
    nativeHost,
    documentListeners,
    get registered() {
      return registered;
    },
    get videoClicks() {
      return videoClicks;
    },
    get songClicks() {
      return songClicks;
    },
  };
}

function labelOf(button) {
  return button.children.find((child) =>
    child.className.includes("ytm-av-toggle-label"),
  )?.textContent;
}

test("video toggle uses the native AV controls when they are enabled", () => {
  const env = createEnv({ native: true, videoMode: true });
  assert.equal(env.registered.name, "video_quick_toggle");

  env.registered.start();
  const button = env.document.getElementById("ytm-player-av-toggle-btn");
  assert.ok(button, "must inject the player-bar AV toggle button");
  assert.equal(env.controls.children[0], button);
  assert.equal(button.title, "Переключить на аудио");
  assert.equal(labelOf(button), "Аудио");

  button.click();
  assert.equal(env.videoClicks, 0);
  assert.equal(env.songClicks, 1);

  env.nativeHost.playbackMode = "ATV_PREFERRED";
  env.player.playbackMode = "ATV_PREFERRED";
  env.videoButton.setAttribute("aria-pressed", "false");
  env.songButton.setAttribute("aria-pressed", "true");
  env.documentListeners.get("yt-navigate-finish")();
  assert.equal(button.title, "Переключить на видео");
  assert.equal(labelOf(button), "Видео");

  button.click();
  assert.equal(env.videoClicks, 1);
  assert.equal(env.songClicks, 1);

  env.registered.stop();
  assert.equal(env.document.getElementById("ytm-player-av-toggle-btn"), null);
  assert.equal(env.document.getElementById("ytm-tauri-video-toggle-style"), null);
});

test("video toggle falls back to a visual audio mode when native switching is disabled", () => {
  const env = createEnv({ native: true, nativeDisabled: true, videoMode: true });
  env.registered.start();
  const button = env.document.getElementById("ytm-player-av-toggle-btn");
  assert.ok(button);
  assert.equal(button.title, "Переключить на аудио");
  assert.equal(labelOf(button), "Аудио");

  button.click();
  assert.equal(env.songClicks, 0);
  assert.equal(env.videoClicks, 0);
  assert.ok(env.player.classList.contains("ytm-visual-audio-mode"));
  assert.equal(env.thumbnailImage.getAttribute("src"), "https://img.example/large.jpg");
  assert.equal(env.blurImage.getAttribute("src"), "https://img.example/large.jpg");
  assert.equal(button.title, "Переключить на видео");
  assert.equal(labelOf(button), "Видео");

  button.click();
  assert.equal(env.player.classList.contains("ytm-visual-audio-mode"), false);
  assert.equal(button.title, "Переключить на аудио");
  assert.equal(labelOf(button), "Аудио");
});

test("visual audio mode updates album art after a track change", () => {
  const env = createEnv({ native: false, videoMode: true });
  env.registered.start();
  const button = env.document.getElementById("ytm-player-av-toggle-btn");
  button.click();
  assert.ok(env.player.classList.contains("ytm-visual-audio-mode"));

  env.player.playerResponse.videoDetails.videoId = "video-2";
  env.player.playerResponse.videoDetails.thumbnail.thumbnails = [
    { url: "https://img.example/next.jpg", width: 1280, height: 720 },
  ];
  env.documentListeners.get("yt-navigate-finish")();
  assert.equal(env.thumbnailImage.getAttribute("src"), "https://img.example/next.jpg");
  assert.ok(env.player.classList.contains("ytm-visual-audio-mode"));
});

test("video toggle hides itself for audio-only tracks without a video counterpart", () => {
  const env = createEnv({ native: false, videoMode: false });
  env.registered.start();
  const button = env.document.getElementById("ytm-player-av-toggle-btn");
  assert.ok(button);
  assert.equal(button.style.display, "none");
  assert.equal(env.player.classList.contains("ytm-visual-audio-mode"), false);
});
