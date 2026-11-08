import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src-tauri/src/download_probe.js", import.meta.url), "utf8");

function createMockElement(tagName) {
  const listeners = new Map();
  const attributes = new Map();
  const children = [];

  const elem = {
    tagName: tagName.toUpperCase(),
    id: "",
    className: "",
    style: {},
    textContent: "",
    children,
    parentNode: null,
    disabled: false,
    value: "",
    checked: false,
    selected: false,
    type: "",
    placeholder: "",
    spellcheck: true,
    title: "",
    get firstChild() {
      return children[0] || null;
    },
    get childElementCount() {
      return children.length;
    },
    get isConnected() {
      let node = elem;
      while (node) {
        if (node.tagName === "HTML") return true;
        node = node.parentNode;
      }
      return false;
    },
    classList: {
      add(name) {
        if (!elem.classList.contains(name)) elem.className = `${elem.className} ${name}`.trim();
      },
      remove(name) {
        elem.className = elem.className
          .split(/\s+/)
          .filter((item) => item && item !== name)
          .join(" ");
      },
      toggle(name, force) {
        const next = force === undefined ? !elem.classList.contains(name) : Boolean(force);
        if (next) elem.classList.add(name);
        else elem.classList.remove(name);
      },
      contains(name) {
        return elem.className.split(/\s+/).includes(name);
      },
    },
    appendChild(child) {
      child.parentNode = elem;
      children.push(child);
      return child;
    },
    append(...nodes) {
      for (const node of nodes) {
        if (typeof node === "string") {
          elem.appendChild({ textContent: node, parentNode: null, nodeType: 3, children: [] });
        } else {
          elem.appendChild(node);
        }
      }
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
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  return elem;
}

function findByText(root, text) {
  const found = [];
  const visit = (node) => {
    if (node.textContent === text) found.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return found;
}

function findAll(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return found;
}

function textOf(root) {
  return [root.textContent, ...(root.children || []).map(textOf)].join(" ");
}

function createEnv({ downloadsEnabled = true } = {}) {
  const html = createMockElement("html");
  const head = createMockElement("head");
  const body = createMockElement("body");
  html.appendChild(head);
  html.appendChild(body);

  const documentListeners = new Map();
  const windowListeners = new Map();

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
    createTextNode(text) {
      return { textContent: String(text), parentNode: null, nodeType: 3 };
    },
    getElementById(id) {
      return findAll(html, (node) => node.id === id)[0] || null;
    },
    querySelector(selector) {
      if (selector === "ytmusic-player-bar") return bar;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
  };

  const anchor = createMockElement("a");
  anchor.setAttribute("href", "watch?v=abc123&list=PLtest");
  const title = createMockElement("yt-formatted-string");
  title.className = "title";
  title.textContent = "Test Song";
  const artistAnchor = createMockElement("a");
  artistAnchor.textContent = "Test Artist";
  const byline = createMockElement("yt-formatted-string");
  byline.className = "byline";
  byline.textContent = "Test Artist • Test Album";
  const image = createMockElement("img");
  image.setAttribute("src", "https://img.test/cover.jpg");
  const controls = createMockElement("div");
  controls.id = "right-controls";

  const bar = createMockElement("ytmusic-player-bar");
  bar.querySelector = (selector) => {
    if (selector.includes("#right-controls")) return controls;
    if (selector.includes("watch?v=")) return anchor;
    if (selector.includes(".byline a")) return artistAnchor;
    if (selector.includes(".byline")) return byline;
    if (selector.includes(".title")) return title;
    if (selector.includes("img")) return image;
    return null;
  };
  bar.appendChild(controls);
  body.appendChild(bar);

  const calls = [];
  const settings = [];
  let jobs = [];

  const context = {
    location: {
      hostname: "music.youtube.com",
      pathname: "/watch",
      origin: "https://music.youtube.com",
      href: "https://music.youtube.com/watch?v=abc123&list=PLtest",
    },
    document,
    URL,
    console,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  context.window = context;
  context.window.addEventListener = (type, handler) => windowListeners.set(type, handler);
  context.window.__ytmFeatures = {
    config: {
      downloads_enabled: downloadsEnabled,
      download_format: "mp3",
      download_bitrate: "192",
      download_sponsorblock: "remove",
      download_sponsorblock_categories: "sponsor,intro",
      download_filename_template: "%(artist,uploader)s - %(title)s.%(ext)s",
      download_cookies_browser: "none",
      download_embed_metadata: true,
      download_embed_thumbnail: true,
      download_concurrency: 2,
      download_dir: "",
    },
    download(action, payload) {
      calls.push({ action, payload });
      return Promise.resolve({ ok: true, downloads: jobs });
    },
    setSetting(key, value) {
      settings.push({ key, value });
      context.window.__ytmFeatures.config[key] = value;
      return Promise.resolve({ ok: true });
    },
  };

  vm.runInNewContext(source, context);

  return {
    context,
    document,
    body,
    bar,
    controls,
    calls,
    settings,
    windowListeners,
    documentListeners,
    setJobs(next) {
      jobs = next;
    },
    get button() {
      return document.getElementById("ytm-player-download-btn");
    },
  };
}

test("download probe injects a player-bar button and queues the current track", async () => {
  const env = createEnv();
  const button = env.button;
  assert.ok(button, "must inject the player download button");
  assert.equal(button.title, "Скачать текущий трек");
  assert.equal(button.children[0]?.tagName, "SVG");
  assert.equal(env.controls.children[0], button);

  await env.context.window.__ytmDownloads.startCurrent(false);
  const start = env.calls.find((call) => call.action === "start");
  assert.ok(start, "must send a start request");
  assert.equal(start.payload.url, "https://music.youtube.com/watch?v=abc123");
  assert.equal(start.payload.body.title, "Test Song");
  assert.equal(start.payload.body.artist, "Test Artist");
  assert.equal(start.payload.body.album, "Test Album");
  assert.equal(start.payload.body.format, "mp3");
  assert.equal(start.payload.body.bitrate, "192");
  assert.equal(start.payload.body.sponsorblock, "remove");
  assert.equal(start.payload.body.playlist, false);

  await env.context.window.__ytmDownloads.startCurrent(true);
  const playlist = env.calls.filter((call) => call.action === "start").at(-1);
  assert.equal(playlist.payload.url, "https://music.youtube.com/playlist?list=PLtest");
  assert.equal(playlist.payload.body.playlist, true);
  assert.equal(playlist.payload.body.title, "");
});

test("download probe settings tab renders controls and the queue", async () => {
  const env = createEnv();
  const container = createMockElement("div");
  env.body.appendChild(container);
  env.setJobs([
    {
      id: 1,
      title: "Test Song",
      artist: "Test Artist",
      format: "mp3",
      bitrate: "192",
      status: "running",
      progress: 42,
      speed: "1.2MiB/s",
      eta: "00:10",
      downloaded_bytes: 1024,
      total_bytes: 2048,
      sponsorblock: "remove",
      filepath: "",
      error: "",
      created_at: 2,
      playlist: false,
    },
    {
      id: 2,
      title: "Done Song",
      artist: "Done Artist",
      format: "best",
      bitrate: "320",
      status: "completed",
      progress: 100,
      speed: "",
      eta: "",
      downloaded_bytes: 0,
      total_bytes: 0,
      sponsorblock: "off",
      filepath: "C:\\Music\\Done Song.opus",
      error: "",
      created_at: 1,
      playlist: false,
    },
    {
      id: 3,
      title: "Failed Song",
      artist: "Failed Artist",
      format: "m4a",
      bitrate: "320",
      status: "failed",
      progress: 0,
      speed: "",
      eta: "",
      downloaded_bytes: 0,
      total_bytes: 0,
      sponsorblock: "off",
      filepath: "",
      error: "ERROR: Unable to download video: [Errno 22] Invalid argument",
      created_at: 0,
      playlist: false,
    },
  ]);

  env.context.window.__ytmDownloads.renderSettings(container);
  await new Promise((resolve) => setImmediate(resolve));

  const text = textOf(container);
  assert.match(text, /Загрузки/);
  assert.match(text, /Формат файла/);
  assert.match(text, /SponsorBlock/);
  assert.match(text, /Очередь и история/);
  assert.match(text, /Test Song/);
  assert.match(text, /Done Song/);
  assert.match(text, /Загружается/);
  assert.match(text, /Готово/);
  assert.match(text, /Ошибка/);
  assert.match(text, /Возможные причины/);

  const formatSelect = findAll(container, (node) => node.tagName === "SELECT").find((select) =>
    select.children.some((option) => option.selected && option.value === "mp3"),
  );
  assert.ok(formatSelect, "format select must reflect the saved setting");
  formatSelect.value = "flac";
  formatSelect.dispatch("change");
  assert.ok(
    env.settings.some((entry) => entry.key === "download_format" && entry.value === "flac"),
    "changing format must persist the setting",
  );

  const cancelButton = findByText(container, "Отменить")[0];
  assert.ok(cancelButton, "running downloads must offer cancel");
  await cancelButton.click();
  assert.ok(
    env.calls.some((call) => call.action === "cancel" && call.payload.id === 1),
    "cancel must send the download id",
  );

  env.context.window.__ytmDownloads.onSettingsClosed();
});

test("download probe hides the player button when the downloader is disabled", () => {
  const env = createEnv({ downloadsEnabled: false });
  assert.equal(env.button.style.display, "none");

  env.context.window.__ytmFeatures.config.downloads_enabled = true;
  const handler = env.windowListeners.get("ytm-settings-changed");
  assert.equal(typeof handler, "function");
  handler();
  assert.equal(env.button.style.display, "inline-flex");
});
