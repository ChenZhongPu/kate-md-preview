import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FIREFOX_APP_CLASS = "kate-md-preview";
const VALID_APP_MODES = new Set([
  "auto",
  "chrome",
  "chromium",
  "edge",
  "brave",
  "firefox",
  "safari",
]);

const FIREFOX_USER_JS = [
  'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);',
  'user_pref("browser.tabs.inTitlebar", 0);',
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.startup.homepage_override.mstone", "ignore");',
  'user_pref("datareporting.policy.firstRunURL", "");',
  'user_pref("browser.aboutwelcome.enabled", false);',
  'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);',
  'user_pref("browser.toolbars.bookmarks.visibility", "never");',
  "",
].join("\n");

const FIREFOX_USER_CHROME_CSS = [
  "/* Minimal chromeless app window for kate-md-preview */",
  "#TabsToolbar,",
  "#titlebar,",
  "#nav-bar,",
  "#PersonalToolbar,",
  "#sidebar-box,",
  "#sidebar-splitter {",
  "  visibility: collapse !important;",
  "}",
  "",
].join("\n");

const SAFARI_NEW_WINDOW_SCRIPT = [
  "on run argv",
  "  set targetURL to item 1 of argv",
  '  tell application "Safari"',
  "    activate",
  "    make new document with properties {URL:targetURL}",
  "  end tell",
  "end run",
].join("\n");

export function normalizeAppMode(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v || v === "0" || v === "false" || v === "off") return null;
  if (v === "1" || v === "true") return "auto";
  if (VALID_APP_MODES.has(v)) return v;
  throw new Error(
    `Invalid --app target "${raw}". Expected one of: auto, chrome, chromium, edge, brave, firefox, safari`
  );
}

function defaultFindInPath(executable, env = process.env, platform = process.platform) {
  const pathDirs = (env.PATH || "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  for (const dir of pathDirs) {
    const full = path.join(dir, executable);
    try {
      if (platform === "win32") {
        if (fs.existsSync(full)) return full;
      } else {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function getWindowsRoots(env = process.env) {
  return [
    env.PROGRAMFILES,
    env["PROGRAMFILES(X86)"],
    env.LOCALAPPDATA,
  ].filter(Boolean);
}

export function findChromiumBrowser({
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  findInPath = defaultFindInPath,
  preferred = "auto",
} = {}) {
  const filterByPreferred = (candidates) => {
    if (!preferred || preferred === "auto" || preferred === "chromium") return candidates;
    const matchers = {
      chrome: /chrome(?!ium)/i,
      edge: /edge/i,
      brave: /brave/i,
    };
    const re = matchers[preferred];
    if (!re) return candidates;
    const matched = candidates.filter((c) => re.test(c));
    return matched.length > 0 ? matched : candidates;
  };

  if (platform === "darwin") {
    const macCandidates = filterByPreferred([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]);
    for (const p of macCandidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  if (platform === "win32") {
    const roots = getWindowsRoots(env);
    const candidates = [
      ["chrome", "Google\\Chrome\\Application\\chrome.exe", "chrome.exe"],
      ["edge", "Microsoft\\Edge\\Application\\msedge.exe", "msedge.exe"],
      ["brave", "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "brave.exe"],
      ["chromium", "Chromium\\Application\\chrome.exe", "chromium.exe"],
    ].filter(([mode]) => preferred === "auto" || preferred === mode);
    for (const [, relativePath] of candidates) {
      for (const root of roots) {
        const full = path.win32.join(root, relativePath);
        if (existsSync(full)) return full;
      }
    }
    for (const [, , name] of candidates) {
      const found = findInPath(name, env, platform);
      if (found) return found;
    }
    return null;
  }

  if (platform === "linux") {
    const linuxCandidates = filterByPreferred([
      "google-chrome-stable",
      "google-chrome",
      "chromium",
      "chromium-browser",
      "brave-browser",
      "brave",
      "microsoft-edge",
      "microsoft-edge-stable",
    ]);
    for (const name of linuxCandidates) {
      const found = findInPath(name, env, platform);
      if (found) return found;
      const usrBin = `/usr/bin/${name}`;
      if (existsSync(usrBin)) return usrBin;
    }
  }

  return null;
}

export function findFirefoxBrowser({
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  findInPath = defaultFindInPath,
} = {}) {
  if (platform === "darwin") {
    const macCandidates = [
      "/Applications/Firefox.app/Contents/MacOS/firefox",
      "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox",
      "/Applications/Firefox Nightly.app/Contents/MacOS/firefox",
    ];
    for (const p of macCandidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  if (platform === "win32") {
    const roots = getWindowsRoots(env);
    const relPaths = [
      "Mozilla Firefox\\firefox.exe",
      "Firefox Developer Edition\\firefox.exe",
    ];
    for (const rel of relPaths) {
      for (const root of roots) {
        const full = path.win32.join(root, rel);
        if (existsSync(full)) return full;
      }
    }
    return findInPath("firefox.exe", env, platform);
  }

  if (platform === "linux") {
    for (const name of ["firefox", "firefox-esr", "firefox-developer-edition", "librewolf"]) {
      const found = findInPath(name, env, platform);
      if (found) return found;
      const usrBin = `/usr/bin/${name}`;
      if (existsSync(usrBin)) return usrBin;
    }
  }

  return null;
}

export function getCacheRoot({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Caches", "kate-md-preview");
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA || os.tmpdir(), "kate-md-preview");
  }
  return path.join(env.XDG_CACHE_HOME || path.join(homeDir, ".cache"), "kate-md-preview");
}

function isProfileLocked(profileDir) {
  for (const lockName of ["lock", ".parentlock", "parent.lock"]) {
    const lockPath = path.join(profileDir, lockName);
    try {
      const stat = fs.lstatSync(lockPath);
      if (stat.isSymbolicLink()) {
        // Firefox on Linux creates a symlink like "127.0.1.1:+12345"
        const target = fs.readlinkSync(lockPath);
        const match = target.match(/\+(\d+)$/);
        if (match) {
          const pid = Number(match[1]);
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            // Stale lock from a dead process
            continue;
          }
        }
        return true;
      }
      if (lockName === "parent.lock" && stat.size === 0) {
        return true;
      }
      return true;
    } catch {
      // Lock file does not exist
    }
  }
  return false;
}

function pruneStaleOverflowProfiles(cacheRoot) {
  try {
    if (!fs.existsSync(cacheRoot)) return;
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("firefox-app-profile-")) continue;
      const full = path.join(cacheRoot, entry.name);
      if (!isProfileLocked(full)) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch {
    // best-effort cleanup
  }
}

export function ensureFirefoxAppProfile({
  platform = process.platform,
  cacheRoot = getCacheRoot({ platform }),
  pid = process.pid,
} = {}) {
  fs.mkdirSync(cacheRoot, { recursive: true });

  const primaryDir = path.join(cacheRoot, "firefox-app-profile");
  let profileDir = primaryDir;
  // On macOS and Windows Firefox forwards new window requests to the running profile.
  if (platform !== "darwin" && platform !== "win32") {
    pruneStaleOverflowProfiles(cacheRoot);
    if (isProfileLocked(primaryDir)) {
      profileDir = path.join(cacheRoot, `firefox-app-profile-${pid}-${Date.now()}`);
    }
  }

  const chromeDir = path.join(profileDir, "chrome");
  fs.mkdirSync(chromeDir, { recursive: true });

  const userJsPath = path.join(profileDir, "user.js");
  if (!fs.existsSync(userJsPath) || fs.readFileSync(userJsPath, "utf8") !== FIREFOX_USER_JS) {
    fs.writeFileSync(userJsPath, FIREFOX_USER_JS, { mode: 0o600 });
  }

  const userChromePath = path.join(chromeDir, "userChrome.css");
  if (
    !fs.existsSync(userChromePath) ||
    fs.readFileSync(userChromePath, "utf8") !== FIREFOX_USER_CHROME_CSS
  ) {
    fs.writeFileSync(userChromePath, FIREFOX_USER_CHROME_CSS, { mode: 0o600 });
  }

  return profileDir;
}

export function resolveBrowserLaunch({
  url,
  appUrl = url,
  appMode = null,
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  findInPath = defaultFindInPath,
  prepareFirefoxProfile = () => ensureFirefoxAppProfile({ platform, cacheRoot: getCacheRoot({ platform, env }) }),
} = {}) {
  const mode = normalizeAppMode(appMode);

  const tryChromium = (preferred) => {
    const bin = findChromiumBrowser({ platform, env, existsSync, findInPath, preferred });
    if (!bin) return null;
    const launchTarget = appUrl || url;
    const args =
      platform === "linux"
        ? ["--class=kate-md-preview", `--app=${launchTarget}`]
        : [`--app=${launchTarget}`];
    return { kind: "chromium", cmd: bin, args };
  };

  const tryFirefox = () => {
    const bin = findFirefoxBrowser({ platform, env, existsSync, findInPath });
    if (!bin) return null;
    const profileDir = prepareFirefoxProfile();
    if (platform === "darwin" || platform === "win32") {
      return { kind: "firefox", cmd: bin, args: ["--profile", profileDir, "--new-window", url] };
    }
    const args =
      platform === "linux"
        ? ["--no-remote", "--profile", profileDir, "--name", FIREFOX_APP_CLASS, url]
        : ["--no-remote", "--profile", profileDir, url];
    return { kind: "firefox", cmd: bin, args };
  };

  const trySafari = () => {
    if (platform !== "darwin") return null;
    return {
      kind: "safari",
      cmd: "osascript",
      args: ["-e", SAFARI_NEW_WINDOW_SCRIPT, url],
    };
  };

  if (mode) {
    if (mode === "firefox") {
      const ff = tryFirefox();
      if (ff) return ff;
    } else if (mode === "safari") {
      const sf = trySafari();
      if (sf) return sf;
    } else if (mode === "chrome" || mode === "chromium" || mode === "edge" || mode === "brave") {
      const ch = tryChromium(mode);
      if (ch) return ch;
    } else {
      // auto: Chromium -> Firefox -> Safari (macOS) -> default browser
      const ch = tryChromium("auto");
      if (ch) return ch;
      const ff = tryFirefox();
      if (ff) return ff;
      const sf = trySafari();
      if (sf) return sf;
    }
  }

  if (platform === "darwin") {
    return { kind: "default", cmd: "open", args: [url] };
  }
  if (platform === "win32") {
    if (mode && mode !== "auto") {
      throw new Error(`Cannot open an app window: ${mode} was not found on Windows.`);
    }
    return {
      kind: "default",
      cmd: path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      args: [
        "-NoProfile", "-NonInteractive", "-Command",
        "Start-Process -FilePath $env:KATE_MD_PREVIEW_OPEN_URL -Verb Open -ErrorAction Stop",
      ],
      env: { ...env, KATE_MD_PREVIEW_OPEN_URL: url },
    };
  }
  return { kind: "default", cmd: "xdg-open", args: [url] };
}

export async function openPreviewUrl({ url, appUrl, appMode }) {
  const launch = resolveBrowserLaunch({ url, appUrl, appMode });
  if (process.platform === "win32" && launch.kind === "default") {
    await execFileAsync(launch.cmd, launch.args, { env: launch.env, windowsHide: true });
    return launch;
  }
  const child = spawn(launch.cmd, launch.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await once(child, "spawn");
  return launch;
}
