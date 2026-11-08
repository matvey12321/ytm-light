(() => {
  if (typeof location === "object" && location.hostname && location.hostname !== "music.youtube.com") {
    return;
  }
  if (window.__ytmAutoConfirmInstalled) return;
  window.__ytmAutoConfirmInstalled = true;

  const PROMPT_RE = /(continue watching|still listening|are you still (there|watching|listening)|video paused)/i;
  const BUTTON_RE = /^(yes|continue|continue watching|i'?m still here|still here|resume|play)$/i;
  const DIALOG_SELECTOR = "ytmusic-you-there-renderer, tp-yt-paper-dialog, ytmusic-dialog";
  const BUTTON_SELECTOR = "button, tp-yt-paper-button, yt-button-renderer button, [role='button']";

  let timer = null;
  let observer = null;
  let scheduled = false;
  let lastClickAt = 0;

  function textOf(element) {
    return String(element?.innerText ?? element?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(element) {
    if (!element) return false;
    if (typeof element.getClientRects === "function") {
      return element.getClientRects().length > 0;
    }
    return element.offsetParent !== null;
  }

  function findButton(dialog) {
    for (const button of dialog.querySelectorAll(BUTTON_SELECTOR)) {
      const label = textOf(button) || button.getAttribute?.("aria-label") || "";
      if (BUTTON_RE.test(label)) return button;
    }
    return null;
  }

  function scan() {
    if (Date.now() - lastClickAt < 3000) return false;

    for (const dialog of document.querySelectorAll(DIALOG_SELECTOR)) {
      if (!isVisible(dialog)) continue;
      if (!PROMPT_RE.test(textOf(dialog))) continue;

      const button = findButton(dialog);
      if (!button) continue;

      lastClickAt = Date.now();
      button.click();
      return true;
    }

    return false;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, 300);
  }

  function start() {
    if (timer) return;
    scan();
    timer = setInterval(scan, 1500);
    if (typeof MutationObserver === "function" && document.body) {
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
    scheduled = false;
  }

  window.__ytmAutoConfirm = { scan };
  window.__ytmFeatures?.register("auto_confirm", { start, stop });
})();
