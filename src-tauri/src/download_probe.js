(() => {
  if (typeof location === "object" && location.hostname && location.hostname !== "music.youtube.com") {
    return;
  }
  if (window.__ytmDownloads) return;

  const STYLE_ID = "ytm-downloads-styles";
  const PLAYER_BTN_ID = "ytm-player-download-btn";
  const TOAST_ID = "ytm-download-toast";
  const DEFAULT_CATEGORIES = "sponsor,intro,outro,selfpromo,interaction,music_offtopic";
  const CATEGORY_OPTIONS = [
    ["sponsor", "Спонсор"],
    ["intro", "Интро"],
    ["outro", "Аутро"],
    ["selfpromo", "Самореклама"],
    ["interaction", "Взаимодействие"],
    ["music_offtopic", "Не музыка"],
    ["preview", "Превью"],
    ["filler", "Заполнитель"],
  ];

  const STATUS_LABELS = {
    queued: "В очереди",
    running: "Загружается",
    completed: "Готово",
    failed: "Ошибка",
    canceled: "Отменено",
  };

  const FORMAT_LABELS = {
    best: "Лучший",
    m4a: "M4A",
    mp3: "MP3",
    opus: "Opus",
    flac: "FLAC",
  };

  const SPONSORBLOCK_LABELS = {
    off: "Выкл.",
    mark: "Пометка",
    remove: "Удаление",
  };

  let toastTimer = 0;
  let pollTimer = 0;
  let pollContainer = null;
  let refreshing = false;
  let buttonBusyUntil = 0;

  function downloadIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z");
    svg.appendChild(path);
    return svg;
  }

  const STYLES = `
    #${PLAYER_BTN_ID} {
      display: inline-flex;
      align-items: center !important;
      justify-content: center !important;
      width: 40px !important;
      height: 40px !important;
      border-radius: 50% !important;
      background: transparent !important;
      border: none !important;
      color: rgba(255, 255, 255, 0.7) !important;
      cursor: pointer !important;
      padding: 0 !important;
      margin: 0 2px !important;
      flex-shrink: 0 !important;
      transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease !important;
    }
    #${PLAYER_BTN_ID}:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #fff !important;
    }
    #${PLAYER_BTN_ID}:active {
      transform: scale(0.94) !important;
    }
    #${PLAYER_BTN_ID}.ytm-download-busy {
      color: #ff3b5c !important;
      animation: ytmDownloadPulse 0.8s infinite ease-in-out;
    }
    @keyframes ytmDownloadPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    #${TOAST_ID} {
      position: fixed;
      left: 50%;
      bottom: 96px;
      transform: translateX(-50%);
      z-index: 2147483646;
      padding: 9px 16px;
      border-radius: 18px;
      background: rgba(20, 20, 20, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #fff;
      font: 600 13px "YouTube Sans", Roboto, system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      max-width: min(520px, 80vw);
      text-align: center;
    }
    #${TOAST_ID}.ytm-download-toast-error {
      border-color: rgba(255, 92, 92, 0.7);
      color: #ffb3b3;
    }
    .ytm-download-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 10px;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ytm-download-item-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .ytm-download-item-title {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      overflow-wrap: anywhere;
    }
    .ytm-download-item-sub {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.55);
      overflow-wrap: anywhere;
    }
    .ytm-download-status {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.7);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .ytm-download-status-running { background: rgba(255, 0, 51, 0.16); color: #ff6b86; }
    .ytm-download-status-completed { background: rgba(76, 175, 80, 0.16); color: #81c784; }
    .ytm-download-status-failed { background: rgba(255, 82, 82, 0.16); color: #ff8a80; }
    .ytm-download-status-canceled { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.55); }
    .ytm-download-progress {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 8px;
    }
    .ytm-download-progress > div {
      height: 100%;
      width: 0;
      background: #ff0033;
      transition: width 0.2s ease;
    }
    .ytm-download-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      margin-top: 6px;
    }
    .ytm-download-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .ytm-download-error {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(255, 82, 82, 0.08);
      border: 1px solid rgba(255, 82, 82, 0.2);
      color: #ffb3b3;
      font: 11px/1.45 Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 96px;
      overflow: auto;
    }
    .ytm-download-empty {
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.45);
      border: 1px dashed rgba(255, 255, 255, 0.12);
      border-radius: 10px;
    }
    .ytm-download-input {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 12px;
      outline: none;
      min-width: 240px;
      max-width: 100%;
      box-sizing: border-box;
    }
    .ytm-download-input:focus {
      border-color: rgba(255, 0, 51, 0.7);
    }
    .ytm-download-check-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 10px;
    }
    .ytm-download-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.75);
      cursor: pointer;
    }
    .ytm-download-check input {
      accent-color: #ff0033;
    }
    .ytm-download-section-title {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      margin: 26px 0 10px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .ytm-download-section-title .ytm-download-section-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ytm-download-note {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.45);
      margin-top: 4px;
    }
  `;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function config() {
    return window.__ytmFeatures?.config || window.__ytmFeatureConfig || {};
  }

  function setSetting(key, value) {
    try {
      const pending = window.__ytmFeatures?.setSetting?.(key, value);
      if (pending && typeof pending.catch === "function") {
        pending.catch((error) => toast(`Could not save setting: ${error?.message || error}`, true));
      }
      return pending;
    } catch (error) {
      toast(`Could not save setting: ${error?.message || error}`, true);
      return null;
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function currentTrack() {
    const bar = document.querySelector("ytmusic-player-bar");
    let href = bar?.querySelector(".title a[href*='watch?v='], a[href*='watch?v=']")?.getAttribute("href") || "";
    if (!href && location.pathname === "/watch") href = location.href;
    if (!href) return null;

    let parsed;
    try {
      parsed = new URL(href, location.origin);
    } catch {
      return null;
    }
    const videoId = parsed.searchParams.get("v");
    if (!videoId) return null;

    const trackUrl = new URL("https://music.youtube.com/watch");
    trackUrl.searchParams.set("v", videoId);

    const list = parsed.searchParams.get("list");
    let playlistUrl = "";
    if (list) {
      const playlist = new URL("https://music.youtube.com/playlist");
      playlist.searchParams.set("list", list);
      playlistUrl = playlist.toString();
    }

    const byline = cleanText(bar?.querySelector(".byline")?.textContent);
    const bylineParts = byline.split(/[•·]/).map((part) => part.trim()).filter(Boolean);
    const artist = cleanText(bar?.querySelector(".byline a")?.textContent) || bylineParts[0] || "";
    const album = bylineParts.length > 1 ? bylineParts[1] : "";
    const thumbnail =
      bar?.querySelector("img.image, img.thumbnail, img")?.getAttribute("src") || "";

    return {
      url: trackUrl.toString(),
      playlistUrl,
      videoId,
      title: cleanText(bar?.querySelector(".title")?.textContent),
      artist,
      album,
      thumbnail,
    };
  }

  function toast(message, isError = false) {
    let node = document.getElementById(TOAST_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = TOAST_ID;
      (document.body || document.documentElement).appendChild(node);
    }
    node.textContent = message;
    node.classList.toggle("ytm-download-toast-error", Boolean(isError));
    node.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (node) node.style.opacity = "0";
    }, 2600);
  }

  function setButtonBusy(button) {
    if (!button) return;
    buttonBusyUntil = Date.now() + 900;
    button.classList.add("ytm-download-busy");
    setTimeout(() => button.classList.remove("ytm-download-busy"), 900);
  }

  async function startCurrent(playlist = false) {
    const track = currentTrack();
    if (!track) {
      toast("Сначала откройте трек для скачивания.", true);
      return null;
    }
    if (playlist && !track.playlistUrl) {
      toast("Для этого трека нет активного плейлиста.", true);
      return null;
    }

    const cfg = config();
    const body = {
      title: playlist ? "" : track.title,
      artist: playlist ? "" : track.artist,
      album: playlist ? "" : track.album,
      thumbnail: playlist ? "" : track.thumbnail,
      format: cfg.download_format || "best",
      bitrate: cfg.download_bitrate || "320",
      sponsorblock: cfg.download_sponsorblock || "off",
      sponsorblock_categories: cfg.download_sponsorblock_categories || DEFAULT_CATEGORIES,
      playlist: Boolean(playlist),
    };

    try {
      const response = await window.__ytmFeatures.download("start", {
        url: playlist ? track.playlistUrl : track.url,
        body,
      });
      toast(playlist ? "Плейлист добавлен в очередь загрузки." : `В очереди: ${track.title || track.videoId}`);
      return response;
    } catch (error) {
      toast(`Ошибка загрузки: ${error?.message || error}`, true);
      return null;
    }
  }

  function downloadAction(action, payload = {}) {
    if (!window.__ytmFeatures?.download) {
      return Promise.reject(new Error("мост загрузчика недоступен"));
    }
    return window.__ytmFeatures.download(action, payload);
  }

  async function refreshQueue(container) {
    if (!container || !container.isConnected || refreshing) return;
    refreshing = true;
    try {
      const response = await downloadAction("list");
      if (!container.isConnected) return;
      renderQueue(container, Array.isArray(response?.downloads) ? response.downloads : []);
    } catch (error) {
      if (!container.isConnected) return;
      container.textContent = "";
      const message = el("div", "ytm-download-empty", `Не удалось загрузить список: ${error?.message || error}`);
      container.appendChild(message);
    } finally {
      refreshing = false;
    }
  }

  function startPolling(container) {
    stopPolling();
    pollContainer = container;
    refreshQueue(container);
    pollTimer = setInterval(() => {
      if (!pollContainer || !pollContainer.isConnected) {
        stopPolling();
        return;
      }
      refreshQueue(pollContainer);
    }, 1500);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
    pollContainer = null;
  }

  function onSettingsClosed() {
    stopPolling();
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || STATUS_LABELS.queued;
  }

  function formatLabel(format) {
    return FORMAT_LABELS[format] || format || "";
  }

  function sponsorblockLabel(value) {
    return SPONSORBLOCK_LABELS[value] || value || "";
  }

  function formatError(message) {
    const text = String(message || "");
    if (/Errno 22|Invalid argument/i.test(text)) {
      return `${text}\nВозможные причины: слишком длинное имя файла, занятая папка или нехватка прав. Попробуйте выбрать другую папку загрузок.`;
    }
    return text;
  }

  function actionButton(label, onClick, primary = false) {
    const button = el("button", `ytm-action-btn${primary ? " ytm-action-btn-primary" : ""}`, label);
    button.type = "button";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        await onClick();
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function renderQueue(container, jobs) {
    container.textContent = "";
    if (!jobs.length) {
      container.appendChild(el("div", "ytm-download-empty", "Пока нет загрузок. Используйте кнопку загрузки в панели плеера."));
      return;
    }

    const sorted = [...jobs].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    for (const job of sorted) {
      const item = el("div", "ytm-download-item");
      const head = el("div", "ytm-download-item-head");
      const info = el("div");
      info.appendChild(el("div", "ytm-download-item-title", job.title || (job.playlist ? "Загрузка плейлиста" : `Трек ${job.id}`)));
      const subtitleParts = [job.artist, formatLabel(job.format), job.bitrate && job.format !== "best" ? `${job.bitrate} кбит/с` : ""].filter(Boolean);
      info.appendChild(el("div", "ytm-download-item-sub", subtitleParts.join(" • ")));
      head.appendChild(info);
      const status = el("span", `ytm-download-status ytm-download-status-${job.status || "queued"}`, statusLabel(job.status));
      head.appendChild(status);
      item.appendChild(head);

      if (job.status === "running" || job.status === "queued") {
        const progress = el("div", "ytm-download-progress");
        const fill = el("div");
        fill.style.width = `${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`;
        progress.appendChild(fill);
        item.appendChild(progress);
      }

      const meta = el("div", "ytm-download-meta");
      if (job.status === "running") {
        if (job.speed) meta.appendChild(el("span", null, `Скорость: ${job.speed}`));
        if (job.eta) meta.appendChild(el("span", null, `Осталось: ${job.eta}`));
        if (job.downloaded_bytes || job.total_bytes) {
          const downloaded = formatBytes(job.downloaded_bytes);
          const total = formatBytes(job.total_bytes);
          meta.appendChild(el("span", null, total ? `${downloaded} / ${total}` : downloaded));
        }
      }
      if (job.sponsorblock && job.sponsorblock !== "off") {
        meta.appendChild(el("span", null, `SponsorBlock: ${sponsorblockLabel(job.sponsorblock)}`));
      }
      if (job.filepath) meta.appendChild(el("span", null, job.filepath));
      if (meta.childElementCount) item.appendChild(meta);

      if (job.error && job.status === "failed") {
        item.appendChild(el("div", "ytm-download-error", formatError(job.error)));
      }

      const actions = el("div", "ytm-download-actions");
      if (job.status === "queued" || job.status === "running") {
        actions.appendChild(
          actionButton("Отменить", async () => {
            try {
              await downloadAction("cancel", { id: job.id });
              await refreshQueue(container);
            } catch (error) {
              toast(`Не удалось отменить: ${error?.message || error}`, true);
            }
          }),
        );
      }
      if (job.status === "failed" || job.status === "canceled") {
        actions.appendChild(
          actionButton(
            "Повторить",
            async () => {
              try {
                await downloadAction("retry", { id: job.id });
                await refreshQueue(container);
              } catch (error) {
                toast(`Не удалось повторить: ${error?.message || error}`, true);
              }
            },
            true,
          ),
        );
      }
      if (job.status === "completed") {
        actions.appendChild(
          actionButton("Открыть папку", async () => {
            try {
              await downloadAction("open_folder", { id: job.id });
            } catch (error) {
              toast(`Не удалось открыть папку: ${error?.message || error}`, true);
            }
          }),
        );
      }
      if (job.status !== "queued" && job.status !== "running") {
        actions.appendChild(
          actionButton("Удалить", async () => {
            try {
              await downloadAction("remove", { id: job.id });
              await refreshQueue(container);
            } catch (error) {
              toast(`Не удалось удалить: ${error?.message || error}`, true);
            }
          }),
        );
      }
      if (actions.childElementCount) item.appendChild(actions);
      container.appendChild(item);
    }
  }

  function settingCard(title, description, control) {
    const card = el("div", "ytm-settings-card");
    const details = el("div", "ytm-card-details");
    details.appendChild(el("div", "ytm-card-name", title));
    details.appendChild(el("div", "ytm-card-summary", description));
    card.appendChild(details);
    if (control) card.appendChild(control);
    return card;
  }

  function toggleControl(checked, onChange) {
    const label = el("label", "ytm-toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    const track = el("span", "ytm-toggle-track");
    label.append(input, track);
    input.addEventListener("change", () => onChange(input.checked));
    return label;
  }

  function selectControl(options, value, onChange) {
    const select = el("select", "ytm-dropdown");
    for (const option of options) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      if (String(option.value) === String(value)) node.selected = true;
      select.appendChild(node);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function textControl(value, placeholder, onCommit) {
    const input = el("input", "ytm-download-input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    input.spellcheck = false;
    const commit = () => {
      const next = input.value.trim();
      onCommit(next);
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    return input;
  }

  function renderCategoryCard() {
    const cfg = config();
    const selected = new Set(
      String(cfg.download_sponsorblock_categories || DEFAULT_CATEGORIES)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const card = el("div", "ytm-settings-card");
    card.style.flexDirection = "column";
    card.style.alignItems = "stretch";
    const details = el("div", "ytm-card-details");
    details.appendChild(el("div", "ytm-card-name", "Категории SponsorBlock"));
    details.appendChild(
      el("div", "ytm-card-summary", "Категории, используемые при пометке или удалении сегментов."),
    );
    card.appendChild(details);

    const row = el("div", "ytm-download-check-row");
    for (const [value, label] of CATEGORY_OPTIONS) {
      const wrapper = el("label", "ytm-download-check");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = selected.has(value);
      input.addEventListener("change", () => {
        if (input.checked) selected.add(value);
        else selected.delete(value);
        const categories = CATEGORY_OPTIONS.map(([item]) => item).filter((item) => selected.has(item));
        setSetting(
          "download_sponsorblock_categories",
          categories.length ? categories.join(",") : DEFAULT_CATEGORIES,
        );
      });
      wrapper.append(input, document.createTextNode(label));
      row.appendChild(wrapper);
    }
    card.appendChild(row);
    return card;
  }

  function renderSettings(container) {
    injectStyles();
    container.textContent = "";
    const cfg = config();

    container.appendChild(el("h2", null, "Загрузки")).style.cssText =
      "font-size:20px;margin:0 0 4px 0;color:#fff;";
    const intro = el(
      "p",
      null,
      "Очередь треков и плейлистов через yt-dlp. Конвертация, метаданные и SponsorBlock используют встроенный ffmpeg.",
    );
    intro.style.cssText = "font-size:12px;color:rgba(255,255,255,0.6);margin:0 0 20px 0;";
    container.appendChild(intro);

    const group = el("div", "ytm-card-group");
    group.appendChild(
      settingCard(
        "Включить загрузчик",
        "Показывать кнопку загрузки в панели плеера и разрешать новые загрузки.",
        toggleControl(cfg.downloads_enabled !== false, (value) => {
          setSetting("downloads_enabled", value);
          updateButtonVisibility();
        }),
      ),
    );

    const quickCard = el("div", "ytm-settings-card");
    const quickDetails = el("div", "ytm-card-details");
    quickDetails.appendChild(el("div", "ytm-card-name", "Быстрая загрузка"));
    quickDetails.appendChild(
      el("div", "ytm-card-summary", "Скачать текущий трек или весь его плейлист."),
    );
    quickCard.appendChild(quickDetails);
    const quickActions = el("div", "ytm-download-actions");
    quickActions.style.marginTop = "0";
    quickActions.appendChild(
      actionButton(
        "Текущий трек",
        async () => {
          await startCurrent(false);
        },
        true,
      ),
    );
    quickActions.appendChild(
      actionButton("Текущий плейлист", async () => {
        await startCurrent(true);
      }),
    );
    quickCard.appendChild(quickActions);
    group.appendChild(quickCard);

    group.appendChild(
      settingCard(
        "Формат файла",
        "«Лучший» сохраняет исходный поток opus/m4a. Остальные форматы конвертируются через ffmpeg.",
        selectControl(
          [
            { value: "best", label: "Лучший (оригинал)" },
            { value: "m4a", label: "M4A" },
            { value: "mp3", label: "MP3" },
            { value: "opus", label: "Opus" },
            { value: "flac", label: "FLAC" },
          ],
          cfg.download_format || "best",
          (value) => setSetting("download_format", value),
        ),
      ),
    );

    group.appendChild(
      settingCard(
        "Битрейт",
        "Используется при конвертации в MP3 и Opus. Для «Лучший», M4A и FLAC не применяется.",
        selectControl(
          [
            { value: "128", label: "128 кбит/с" },
            { value: "192", label: "192 кбит/с" },
            { value: "256", label: "256 кбит/с" },
            { value: "320", label: "320 кбит/с" },
          ],
          cfg.download_bitrate || "320",
          (value) => setSetting("download_bitrate", value),
        ),
      ),
    );

    group.appendChild(
      settingCard(
        "SponsorBlock",
        "Помечать или удалять сегменты по базе SponsorBlock.",
        selectControl(
          [
            { value: "off", label: "Выкл." },
            { value: "mark", label: "Только пометить" },
            { value: "remove", label: "Удалять сегменты" },
          ],
          cfg.download_sponsorblock || "off",
          (value) => setSetting("download_sponsorblock", value),
        ),
      ),
    );
    group.appendChild(renderCategoryCard());

    const dirCard = settingCard(
      "Папка загрузок",
      "Оставьте пустым для папки «Музыка». Папка создаётся при первой загрузке.",
      textControl(cfg.download_dir || "", "По умолчанию: Музыка\\YTM Light", (value) => {
        setSetting("download_dir", value);
      }),
    );
    group.appendChild(dirCard);

    group.appendChild(
      settingCard(
        "Шаблон имени файла",
        "Шаблон вывода yt-dlp. Сохраните подстановку расширения.",
        textControl(
          cfg.download_filename_template || "%(artist,uploader)s - %(title)s.%(ext)s",
          "%(artist,uploader)s - %(title)s.%(ext)s",
          (value) => {
            if (value) setSetting("download_filename_template", value);
          },
        ),
      ),
    );

    group.appendChild(
      settingCard(
        "Источник cookies",
        "Использовать cookies браузера для приватного или возрастного контента. Необязательно.",
        selectControl(
          [
            { value: "none", label: "Нет" },
            { value: "edge", label: "Microsoft Edge" },
            { value: "chrome", label: "Chrome" },
            { value: "firefox", label: "Firefox" },
            { value: "brave", label: "Brave" },
            { value: "opera", label: "Opera" },
            { value: "vivaldi", label: "Vivaldi" },
          ],
          cfg.download_cookies_browser || "none",
          (value) => setSetting("download_cookies_browser", value),
        ),
      ),
    );

    group.appendChild(
      settingCard(
        "Встраивать метаданные",
        "Записывать название, исполнителя, альбом и другие теги в файл.",
        toggleControl(cfg.download_embed_metadata !== false, (value) =>
          setSetting("download_embed_metadata", value),
        ),
      ),
    );
    group.appendChild(
      settingCard(
        "Встраивать обложку",
        "Добавлять обложку, если формат это поддерживает.",
        toggleControl(cfg.download_embed_thumbnail !== false, (value) =>
          setSetting("download_embed_thumbnail", value),
        ),
      ),
    );
    group.appendChild(
      settingCard(
        "Параллельные загрузки",
        "Количество треков, скачиваемых одновременно.",
        selectControl(
          [
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
          ],
          String(cfg.download_concurrency || 1),
          (value) => setSetting("download_concurrency", Number(value)),
        ),
      ),
    );
    container.appendChild(group);

    const section = el("div", "ytm-download-section-title");
    section.appendChild(el("span", null, "Очередь и история"));
    const sectionActions = el("div", "ytm-download-section-actions");
    sectionActions.appendChild(
      actionButton("Открыть папку", async () => {
        try {
          await downloadAction("open_folder", {});
        } catch (error) {
          toast(`Не удалось открыть папку: ${error?.message || error}`, true);
        }
      }),
    );
    sectionActions.appendChild(
      actionButton("Очистить завершённые", async () => {
        try {
          await downloadAction("clear_completed");
          await refreshQueue(queueList);
        } catch (error) {
          toast(`Не удалось очистить историю: ${error?.message || error}`, true);
        }
      }),
    );
    sectionActions.appendChild(
      actionButton("Обновить", async () => {
        await refreshQueue(queueList);
      }),
    );
    section.appendChild(sectionActions);
    container.appendChild(section);

    const queueList = el("div", "ytm-card-group");
    container.appendChild(queueList);
    startPolling(queueList);

    const note = el(
      "div",
      "ytm-download-note",
      "Загрузки выполняются в фоне. При закрытии приложения активные процессы yt-dlp останавливаются; незавершённые задачи помечаются ошибкой при следующем запуске.",
    );
    container.appendChild(note);
  }

  function updateButtonVisibility() {
    const button = document.getElementById(PLAYER_BTN_ID);
    if (!button) return;
    button.style.display = config().downloads_enabled === false ? "none" : "inline-flex";
  }

  function ensurePlayerButton() {
    injectStyles();
    const bar = document.querySelector("ytmusic-player-bar");
    if (!bar) return;
    const controls = bar.querySelector(
      "#right-controls .right-controls-buttons, #right-controls, .right-controls-buttons",
    );
    if (!controls) return;
    let button = document.getElementById(PLAYER_BTN_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = PLAYER_BTN_ID;
      button.type = "button";
      button.title = "Скачать текущий трек";
      button.setAttribute("aria-label", "Скачать текущий трек");
      button.appendChild(downloadIcon());
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (Date.now() < buttonBusyUntil) return;
        setButtonBusy(button);
        await startCurrent(false);
      });
      controls.insertBefore(button, controls.firstChild);
    }
    updateButtonVisibility();
  }

  window.addEventListener("ytm-settings-changed", updateButtonVisibility);
  document.addEventListener("yt-navigate-finish", ensurePlayerButton, true);

  const install = () => {
    if (!document.documentElement) {
      setTimeout(install, 50);
      return;
    }
    injectStyles();
    ensurePlayerButton();
    setInterval(ensurePlayerButton, 2000);
  };

  window.__ytmDownloads = {
    startCurrent,
    startPlaylist: () => startCurrent(true),
    currentTrack,
    list: () => downloadAction("list"),
    openSettings: () => window.__ytmSettings?.open?.("downloads"),
    renderSettings,
    onSettingsClosed,
    refresh: () => (pollContainer ? refreshQueue(pollContainer) : Promise.resolve()),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
