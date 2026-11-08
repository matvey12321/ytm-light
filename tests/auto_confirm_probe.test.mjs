import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src-tauri/src/auto_confirm_probe.js", import.meta.url),
  "utf8",
);

function createAutoConfirmEnv({ hostname = "music.youtube.com", dialogs = [] } = {}) {
  const clicks = [];
  let registered = null;

  const document = {
    body: {},
    querySelectorAll(selector) {
      return selector.includes("ytmusic-you-there-renderer") ? dialogs : [];
    },
  };

  const window = {
    __ytmFeatures: {
      register(name, feature) {
        registered = { name, feature };
      },
    },
  };

  vm.runInNewContext(source, {
    window,
    document,
    location: { hostname },
    console,
    Date,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  });

  return { clicks, registered };
}

function createDialog({ text, buttonText = "Yes" }) {
  const clicks = [];
  const button = {
    textContent: buttonText,
    getAttribute() {
      return null;
    },
    click() {
      clicks.push(buttonText);
    },
  };
  const dialog = {
    innerText: text,
    getClientRects() {
      return [{}];
    },
    querySelectorAll() {
      return [button];
    },
  };
  return { dialog, clicks };
}

test("auto-confirm clicks Yes on a Continue watching prompt", () => {
  const { dialog, clicks } = createDialog({ text: "Continue watching?" });
  const env = createAutoConfirmEnv({ dialogs: [dialog] });

  assert.equal(env.registered?.name, "auto_confirm");
  assert.equal(env.registered.feature.update, undefined);
  env.registered.feature.start();

  assert.deepEqual(clicks, ["Yes"]);
  env.registered.feature.stop();
});

test("auto-confirm answers a Still listening prompt", () => {
  const { dialog, clicks } = createDialog({
    text: "Are you still listening?",
    buttonText: "I'm still here",
  });
  const env = createAutoConfirmEnv({ dialogs: [dialog] });

  env.registered.feature.start();

  assert.deepEqual(clicks, ["I'm still here"]);
  env.registered.feature.stop();
});

test("auto-confirm resumes a paused video prompt", () => {
  const { dialog, clicks } = createDialog({
    text: "Video paused. Continue watching?",
    buttonText: "Continue watching",
  });
  const env = createAutoConfirmEnv({ dialogs: [dialog] });

  env.registered.feature.start();

  assert.deepEqual(clicks, ["Continue watching"]);
  env.registered.feature.stop();
});

test("auto-confirm never clicks a negative response", () => {
  const { dialog, clicks } = createDialog({
    text: "Are you still listening?",
    buttonText: "No",
  });
  const env = createAutoConfirmEnv({ dialogs: [dialog] });

  env.registered.feature.start();

  assert.deepEqual(clicks, []);
  env.registered.feature.stop();
});

test("auto-confirm ignores unrelated dialogs", () => {
  const { dialog, clicks } = createDialog({ text: "Delete this playlist?" });
  const env = createAutoConfirmEnv({ dialogs: [dialog] });

  env.registered.feature.start();

  assert.deepEqual(clicks, []);
  env.registered.feature.stop();
});

test("auto-confirm does not install off the YouTube Music host", () => {
  const env = createAutoConfirmEnv({ hostname: "www.youtube.com" });
  assert.equal(env.registered, null);
});
