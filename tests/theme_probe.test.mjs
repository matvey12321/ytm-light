import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src-tauri/src/theme_probe.js", import.meta.url),
  "utf8",
);

function createThemeEnv({ hostname = "music.youtube.com" } = {}) {
  const elements = new Map();
  let registered = null;

  const head = {
    appendChild(element) {
      elements.set(element.id, element);
    },
  };

  const document = {
    head,
    documentElement: head,
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        id: "",
        textContent: "",
        remove() {
          elements.delete(this.id);
        },
      };
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
  });

  return { elements, registered };
}

test("theme probe applies a preset and custom CSS", () => {
  const env = createThemeEnv();
  assert.equal(env.registered?.name, "theme");

  env.registered.feature.start({
    theme: "amoled",
    custom_css: "body { color: red; }",
  });

  const style = env.elements.get("ytm-light-theme");
  assert.ok(style);
  assert.match(style.textContent, /#000/);
  assert.match(style.textContent, /color: red/);

  env.registered.feature.update({ theme: "default", custom_css: "" });
  assert.equal(env.elements.get("ytm-light-theme"), undefined);
});

test("theme probe does not install off the YouTube Music host", () => {
  const env = createThemeEnv({ hostname: "www.youtube.com" });
  assert.equal(env.registered, null);
});
