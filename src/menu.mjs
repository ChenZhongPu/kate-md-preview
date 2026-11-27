import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveStableNodePath } from "./kate.mjs";

const DEFAULT_ICON_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets",
  "icon.svg"
);

const OPEN_WITH_FILENAME = "kate-md-preview-open.desktop";
const DOLPHIN_MENU_FILENAME = "kate-md-preview.desktop";
const CHROME_APP_ID = "chrome-127.0.0.1__kate-md-preview-Default";

export function getMenuPaths(env = process.env, homeDir = os.homedir()) {
  const dataRoot = env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");
  return {
    applicationsDir: path.join(dataRoot, "applications"),
    serviceMenusDir: path.join(dataRoot, "kio", "servicemenus"),
  };
}

function escapeDesktopArg(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

export function buildOpenWithDesktopEntry({
  nodePath,
  cliPath,
  iconPath = DEFAULT_ICON_PATH,
  useBrowser = false,
} = {}) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Markdown Preview",
    "Name[zh_CN]=Markdown 预览",
    "Comment=Preview Markdown in GitHub style",
    `Exec=${escapeDesktopArg(nodePath)} ${escapeDesktopArg(cliPath)} ${modeFlag} %f`,
    `Icon=${iconPath}`,
    "MimeType=text/markdown;",
    `StartupWMClass=${CHROME_APP_ID}`,
    "Terminal=false",
    "NoDisplay=true",
    "StartupNotify=false",
    "",
  ].join("\n");
}

export function buildDolphinServiceMenu({
  nodePath,
  cliPath,
  iconPath = DEFAULT_ICON_PATH,
  useBrowser = false,
} = {}) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  return [
    "[Desktop Entry]",
    "Type=Service",
    "MimeType=text/markdown;",
    "Actions=preview;",
    "X-KDE-MaxNumberOfUrls=1",
    "",
    "[Desktop Action preview]",
    "Name=Markdown Preview",
    "Name[zh_CN]=Markdown 预览",
    `Icon=${iconPath}`,
    `Exec=${escapeDesktopArg(nodePath)} ${escapeDesktopArg(cliPath)} ${modeFlag} %f`,
    "",
  ].join("\n");
}

function writeIdempotent(filePath, content, { dryRun, mode }) {
  let status = "installed";
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    const currentMode = fs.statSync(filePath).mode & 0o777;
    status = existing === content && currentMode === mode ? "unchanged" : "updated";
  }
  if (!dryRun && status !== "unchanged") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, { mode });
    fs.chmodSync(filePath, mode);
  }
  return status;
}

function refreshLinuxDesktopCaches(applicationsDir) {
  try {
    spawnSync("update-desktop-database", [applicationsDir], { stdio: "ignore" });
  } catch {
    // optional tool
  }
  try {
    spawnSync("kbuildsycoca6", [], { stdio: "ignore" });
  } catch {
    // optional KDE tool
  }
}

export function installLinuxMenu({
  cliPath,
  nodePath = resolveStableNodePath(),
  iconPath = DEFAULT_ICON_PATH,
  applicationsDir = getMenuPaths().applicationsDir,
  serviceMenusDir = getMenuPaths().serviceMenusDir,
  useBrowser = false,
  dryRun = false,
  refreshCaches = true,
} = {}) {
  const results = [];

  const openWithPath = path.join(applicationsDir, OPEN_WITH_FILENAME);
  const openWithContent = buildOpenWithDesktopEntry({ nodePath, cliPath, iconPath, useBrowser });
  results.push({
    name: "Freedesktop Open With",
    filePath: openWithPath,
    content: openWithContent,
    status: writeIdempotent(openWithPath, openWithContent, { dryRun, mode: 0o644 }),
  });

  if (serviceMenusDir) {
    const dolphinPath = path.join(serviceMenusDir, DOLPHIN_MENU_FILENAME);
    const dolphinContent = buildDolphinServiceMenu({ nodePath, cliPath, iconPath, useBrowser });
    results.push({
      name: "KDE Dolphin Service Menu",
      filePath: dolphinPath,
      content: dolphinContent,
      status: writeIdempotent(dolphinPath, dolphinContent, { dryRun, mode: 0o755 }),
    });
  }

  if (!dryRun && refreshCaches && results.some((r) => r.status !== "unchanged")) {
    refreshLinuxDesktopCaches(applicationsDir);
  }

  return results;
}

export function uninstallLinuxMenu({
  applicationsDir = getMenuPaths().applicationsDir,
  serviceMenusDir = getMenuPaths().serviceMenusDir,
  dryRun = false,
  refreshCaches = true,
} = {}) {
  const removed = [];
  const targets = [path.join(applicationsDir, OPEN_WITH_FILENAME)];
  if (serviceMenusDir) {
    targets.push(path.join(serviceMenusDir, DOLPHIN_MENU_FILENAME));
  }

  for (const filePath of targets) {
    if (fs.existsSync(filePath)) {
      if (!dryRun) {
        fs.unlinkSync(filePath);
      }
      removed.push(filePath);
    }
  }

  if (!dryRun && refreshCaches && removed.length > 0) {
    refreshLinuxDesktopCaches(applicationsDir);
  }

  return removed;
}
