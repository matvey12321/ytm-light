import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

test("default build produces an unsigned Windows installer", () => {
  assert.match(packageJson.scripts.build, /build-windows\.ps1/);
  assert.match(packageJson.scripts["build:unsigned"], /build-windows\.ps1/);
  assert.equal(packageJson.scripts["build:tauri"], "tauri build");

  const buildScript = readFileSync(
    new URL("../scripts/build-windows.ps1", import.meta.url),
    "utf8",
  );
  assert.match(buildScript, /npm run build:tauri/);
  assert.match(buildScript, /verify-windows-bundle\.ps1/);
  assert.doesNotMatch(buildScript, /TAURI_SIGNING|CertificateThumbprint|AllowUnsigned/);

  const verifyScript = readFileSync(
    new URL("../scripts/verify-windows-bundle.ps1", import.meta.url),
    "utf8",
  );
  assert.match(verifyScript, /ytm-light\.exe/);
  assert.match(verifyScript, /bundle\\nsis/);
  assert.doesNotMatch(verifyScript, /Updater signature|signature from tauri secret key/);
});

test("application versions stay aligned", () => {
  const cargoToml = readFileSync(
    new URL("../src-tauri/Cargo.toml", import.meta.url),
    "utf8",
  );
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(tauriConfig.version, packageJson.version);
  assert.match(
    cargoToml,
    new RegExp(`^version = "${packageJson.version.replaceAll(".", "\\.")}"$`, "m"),
  );
});

test("in-app updater is removed", () => {
  assert.equal(tauriConfig.plugins?.updater, undefined);
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, false);
  assert.equal(
    existsSync(new URL("../src-tauri/src/updates.rs", import.meta.url)),
    false,
  );

  const cargoToml = readFileSync(
    new URL("../src-tauri/Cargo.toml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(cargoToml, /tauri-plugin-updater/);

  const releaseWorkflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(releaseWorkflow, /TAURI_SIGNING|uploadUpdaterJson|updaterJsonPreferNsis/);
});

test("first install embeds the WebView2 bootstrapper", () => {
  assert.equal(
    tauriConfig.bundle.windows.webviewInstallMode.type,
    "embedBootstrapper",
  );
});

test("downloader sidecars are bundled and are real binaries", () => {
  assert.deepEqual(tauriConfig.bundle.externalBin, [
    "binaries/yt-dlp",
    "binaries/ffmpeg",
    "binaries/ffprobe",
  ]);

  for (const name of ["yt-dlp", "ffmpeg", "ffprobe"]) {
    const path = new URL(
      `../src-tauri/binaries/${name}-x86_64-pc-windows-msvc.exe`,
      import.meta.url,
    );
    assert.ok(existsSync(path), `${name} sidecar must exist`);
    assert.ok(
      statSync(path).size > 1024 * 1024,
      `${name} sidecar must not be a placeholder or truncated download`,
    );
  }
});

test("downloader sidecars are fetched outside Git and in CI", () => {
  const gitignore = readFileSync(
    new URL("../.gitignore", import.meta.url),
    "utf8",
  );
  assert.match(gitignore, /src-tauri\/binaries\/\*\.exe/);

  const fetchScript = readFileSync(
    new URL("../scripts/fetch-sidecars.ps1", import.meta.url),
    "utf8",
  );
  assert.match(fetchScript, /ytDlpVersion = '2026\.10\.26'/);
  assert.match(fetchScript, /ffmpegVersion = '9\.0\.2'/);
  assert.match(
    fetchScript,
    /F5389D3698ECDE4EF06F4E6B1CE0294FE9AC1396228C8990B8D3416D6D177A7D/,
  );
  assert.equal(
    packageJson.scripts["fetch:sidecars"],
    "powershell -NoProfile -File scripts/fetch-sidecars.ps1",
  );

  for (const workflowName of ["checks.yml", "release.yml"]) {
    const workflow = readFileSync(
      new URL(`../.github/workflows/${workflowName}`, import.meta.url),
      "utf8",
    );
    assert.match(workflow, /npm run fetch:sidecars/);
  }

  const releaseWorkflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.match(releaseWorkflow, /contents: write/);
  assert.match(releaseWorkflow, /gh release create/);
});

test("Windows installers register the media-session application identity", () => {
  const windows = tauriConfig.bundle.windows;
  assert.deepEqual(windows.wix.fragmentPaths, ["wix/app-identity.wxs"]);
  assert.deepEqual(windows.wix.componentGroupRefs, [
    "AppUserModelIdentityComponents",
  ]);
  assert.equal(windows.nsis.installerHooks, "nsis/installer-hooks.nsh");

  const wixIdentity = readFileSync(
    new URL("../src-tauri/wix/app-identity.wxs", import.meta.url),
    "utf8",
  );
  const nsisHooks = readFileSync(
    new URL("../src-tauri/nsis/installer-hooks.nsh", import.meta.url),
    "utf8",
  );

  for (const source of [wixIdentity, nsisHooks]) {
    assert.match(source, /app\.ytmlight\.desktop/);
    assert.match(source, /DisplayName/);
    assert.match(source, /IconUri/);
    assert.match(source, /YTM Light/);
  }

  const mainSource = readFileSync(
    new URL("../src-tauri/src/main.rs", import.meta.url),
    "utf8",
  );
  const platformSource = readFileSync(
    new URL("../src-tauri/src/platform.rs", import.meta.url),
    "utf8",
  );
  const libSource = readFileSync(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  assert.match(mainSource, /SetCurrentProcessExplicitAppUserModelID/);
  assert.match(platformSource, /SHGetPropertyStoreForWindow/);
  assert.match(platformSource, /APP_USER_MODEL_ID.*app\.ytmlight\.desktop/);
  assert.match(libSource, /set_window_app_identity\(&window\)/);
});

test("MSI license source remains plain text for Tauri's RTF conversion", () => {
  assert.doesNotMatch(tauriConfig.bundle.licenseFile, /\.rtf$/i);

  const licenseSource = readFileSync(
    new URL(`../src-tauri/${tauriConfig.bundle.licenseFile}`, import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(licenseSource, /^\{\\rtf1\\ansi/);
  assert.match(licenseSource, /^MIT License/);
});
