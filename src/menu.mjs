import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveStableNodePath } from "./kate.mjs";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "assets");
const DEFAULT_ICON_SVG = path.join(ASSETS_DIR, "icon.svg");

const OPEN_WITH_FILENAME = "kate-md-preview-open.desktop";
const DOLPHIN_MENU_FILENAME = "kate-md-preview.desktop";
const CHROME_APP_ID = "chrome-127.0.0.1__kate-md-preview-Default";

const WINDOWS_EXTENSIONS = [".md", ".markdown"];
const WINDOWS_MENU_KEY = "kate-md-preview";
const WINDOWS_LABEL = "Markdown Preview";
const WINDOWS_LAUNCHER = "launch.js";
const LEGACY_WINDOWS_LAUNCHER = "launch.vbs";

const MAC_APP_NAME = "Markdown Preview.app";
const MAC_BUNDLE_ID = "io.github.chenzhongpu.kate-md-preview";
const MAC_ICON_FILENAME = "kate-md-preview.icns";
const MAC_LAUNCHER_VERSION = 4;
const MAC_MARKER_REL = path.join("Contents", "Resources", "kate-md-preview.json");
const MAC_MARKDOWN_UTI = "net.daringfireball.markdown";
const LSREGISTER_BIN =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function defaultRunCommand(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
}

export function getMenuPaths(env = process.env, homeDir = os.homedir()) {
  const dataRoot = env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");
  return {
    applicationsDir: path.join(dataRoot, "applications"),
    serviceMenusDir: path.join(dataRoot, "kio", "servicemenus"),
  };
}

export function getWindowsMenuDir(env = process.env, homeDir = os.homedir()) {
  const base = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  return path.join(base, "kate-md-preview");
}

export function getMacApplicationsDir(homeDir = os.homedir()) {
  return path.join(homeDir, "Applications");
}

function escapeDesktopArg(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function windowsScriptString(value) {
  // Windows Script Host may read scripts using the system ANSI code page.
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export function buildOpenWithDesktopEntry({
  nodePath,
  cliPath,
  iconPath = DEFAULT_ICON_SVG,
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
  iconPath = DEFAULT_ICON_SVG,
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

function buildWindowsLauncherScript({ nodePath, cliPath, useBrowser }) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  const prefix = windowsScriptString(`"${cliPath}" ${modeFlag} "`);
  return [
    "if (WScript.Arguments.length > 0) {",
    '  var shell = new ActiveXObject("Shell.Application");',
    `  var args = ${prefix} + WScript.Arguments.Item(0) + '"';`,
    `  shell.ShellExecute(${windowsScriptString(nodePath)}, args, "", "open", 0);`,
    "}",
    "",
  ].join("\r\n");
}

function buildMacLauncherScript({ nodePath, cliPath, useBrowser }) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  return [
    'ObjC.import("Foundation");',
    "",
    "function openDocuments(documents) {",
    "  for (const document of documents) {",
    "    const task = $.NSTask.alloc.init;",
    `    task.executableURL = $.NSURL.fileURLWithPath(${JSON.stringify(nodePath)});`,
    `    task.arguments = [${JSON.stringify(cliPath)}, ${JSON.stringify(modeFlag)}, document.toString()];`,
    "    task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;",
    "    task.standardError = $.NSFileHandle.fileHandleWithNullDevice;",
    "    task.launch;",
    "  }",
    "}",
    "",
  ].join("\n");
}

function writeIdempotent(filePath, content, { dryRun, mode }) {
  let status = "installed";
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    const currentMode = mode != null ? fs.statSync(filePath).mode & 0o777 : null;
    status = existing === content && (mode == null || currentMode === mode) ? "unchanged" : "updated";
  }
  if (!dryRun && status !== "unchanged") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (mode != null) {
      fs.writeFileSync(filePath, content, { mode });
      try {
        fs.chmodSync(filePath, mode);
      } catch {
        // ignore chmod on non-POSIX filesystems
      }
    } else {
      fs.writeFileSync(filePath, content);
    }
  }
  return status;
}

function refreshLinuxDesktopCaches(applicationsDir, runCommand) {
  try {
    runCommand("update-desktop-database", [applicationsDir]);
  } catch {
    // optional tool
  }
  try {
    runCommand("kbuildsycoca6", []);
  } catch {
    // optional KDE tool
  }
}

export function installLinuxMenu({
  cliPath,
  nodePath = resolveStableNodePath(),
  iconPath = DEFAULT_ICON_SVG,
  applicationsDir = getMenuPaths().applicationsDir,
  serviceMenusDir = getMenuPaths().serviceMenusDir,
  useBrowser = false,
  dryRun = false,
  refreshCaches = true,
  runCommand = defaultRunCommand,
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
    refreshLinuxDesktopCaches(applicationsDir, runCommand);
  }

  return results;
}

export function uninstallLinuxMenu({
  applicationsDir = getMenuPaths().applicationsDir,
  serviceMenusDir = getMenuPaths().serviceMenusDir,
  dryRun = false,
  refreshCaches = true,
  runCommand = defaultRunCommand,
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
    refreshLinuxDesktopCaches(applicationsDir, runCommand);
  }

  return removed;
}

export function getWindowsRegistryKeys() {
  return WINDOWS_EXTENSIONS.map((ext) => ({
    ext,
    shellKey: `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\${WINDOWS_MENU_KEY}`,
    commandKey: `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\${WINDOWS_MENU_KEY}\\command`,
  }));
}

export function installWindowsMenu({
  cliPath,
  nodePath = resolveStableNodePath(),
  menuDir = getWindowsMenuDir(),
  useBrowser = false,
  dryRun = false,
  runCommand = defaultRunCommand,
} = {}) {
  const results = [];
  const launcherPath = path.join(menuDir, WINDOWS_LAUNCHER);
  const launcherContent = buildWindowsLauncherScript({ nodePath, cliPath, useBrowser });
  const launcherStatus = writeIdempotent(launcherPath, launcherContent, { dryRun, mode: null });
  results.push({
    name: "Windows Silent Launcher",
    filePath: launcherPath,
    content: launcherContent,
    status: launcherStatus,
  });

  const wscriptPath = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
  const commandValue = `"${wscriptPath}" //E:JScript "${launcherPath}" "%1"`;
  for (const { ext, shellKey, commandKey } of getWindowsRegistryKeys()) {
    let status = "installed";
    if (!dryRun) {
      const existingCmd = runCommand("reg", ["query", commandKey, "/ve"]);
      const alreadyMatches =
        existingCmd?.status === 0 &&
        String(existingCmd.stdout || "").includes(commandValue);
      if (alreadyMatches) {
        status = "unchanged";
      } else {
        const hadKey = existingCmd?.status === 0;
        const r1 = runCommand("reg", ["add", shellKey, "/ve", "/t", "REG_SZ", "/d", WINDOWS_LABEL, "/f"]);
        if (r1?.status !== 0) {
          throw new Error(`Failed to write registry key ${shellKey}: ${r1?.stderr || r1?.stdout || ""}`);
        }
        const r2 = runCommand("reg", ["add", commandKey, "/ve", "/t", "REG_SZ", "/d", commandValue, "/f"]);
        if (r2?.status !== 0) {
          throw new Error(`Failed to write registry key ${commandKey}: ${r2?.stderr || r2?.stdout || ""}`);
        }
        status = hadKey ? "updated" : "installed";
      }
    }
    results.push({
      name: `Windows Explorer (${ext})`,
      filePath: shellKey,
      content: commandValue,
      status,
    });
  }

  if (!dryRun) {
    fs.rmSync(path.join(menuDir, LEGACY_WINDOWS_LAUNCHER), { force: true });
  }
  return results;
}

export function uninstallWindowsMenu({
  menuDir = getWindowsMenuDir(),
  dryRun = false,
  runCommand = defaultRunCommand,
} = {}) {
  const removed = [];

  for (const { shellKey } of getWindowsRegistryKeys()) {
    const query = runCommand("reg", ["query", shellKey]);
    if (query?.status === 0) {
      if (!dryRun) {
        const result = runCommand("reg", ["delete", shellKey, "/f"]);
        if (result?.status !== 0) {
          throw new Error(`Failed to delete registry key ${shellKey}: ${result?.stderr || result?.stdout || result?.error?.message || "unknown error"}`);
        }
      }
      removed.push(shellKey);
    }
  }

  for (const name of [WINDOWS_LAUNCHER, LEGACY_WINDOWS_LAUNCHER]) {
    const launcherPath = path.join(menuDir, name);
    if (!fs.existsSync(launcherPath)) continue;
    if (!dryRun) {
      fs.unlinkSync(launcherPath);
    }
    removed.push(launcherPath);
  }

  return removed;
}

function runMacCommand(runCommand, cmd, args) {
  const result = runCommand(cmd, args);
  if (result?.status !== 0) {
    throw new Error(`${cmd} failed: ${result?.stderr || result?.stdout || result?.error?.message || "unknown error"}`);
  }
}

function patchMacInfoPlist(plistPath, runCommand) {
  const documentTypes = [{
    CFBundleTypeName: "Markdown Document",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: [MAC_MARKDOWN_UTI],
  }];
  const importedTypes = [{
    UTTypeIdentifier: MAC_MARKDOWN_UTI,
    UTTypeDescription: "Markdown Document",
    UTTypeConformsTo: ["public.utf8-plain-text", "public.content"],
    UTTypeTagSpecification: {
      "public.filename-extension": ["md", "markdown", "mdown", "mkd"],
      "public.mime-type": ["text/markdown"],
    },
  }];
  for (const [key, type, value] of [
    ["CFBundleIdentifier", "-string", MAC_BUNDLE_ID],
    ["CFBundleName", "-string", "Markdown Preview"],
    ["CFBundleVersion", "-string", String(MAC_LAUNCHER_VERSION)],
    ["CFBundleIconFile", "-string", MAC_ICON_FILENAME],
    ["LSUIElement", "-bool", "YES"],
    ["CFBundleDocumentTypes", "-json", JSON.stringify(documentTypes)],
    ["UTImportedTypeDeclarations", "-json", JSON.stringify(importedTypes)],
  ]) {
    runMacCommand(runCommand, "plutil", ["-replace", key, type, value, plistPath]);
  }
  const iconName = runCommand("plutil", ["-extract", "CFBundleIconName", "xml1", "-o", "-", plistPath]);
  if (iconName?.status === 0) {
    runMacCommand(runCommand, "plutil", ["-remove", "CFBundleIconName", plistPath]);
  }
}

export function installMacMenu({
  cliPath,
  nodePath = resolveStableNodePath(),
  iconPngPath,
  applicationsDir = getMacApplicationsDir(),
  useBrowser = false,
  dryRun = false,
  runCommand = defaultRunCommand,
} = {}) {
  const appPath = path.join(applicationsDir, MAC_APP_NAME);
  const markerPath = path.join(appPath, MAC_MARKER_REL);
  const desiredMarker = JSON.stringify({
    managedBy: "kate-md-preview",
    launcherVersion: MAC_LAUNCHER_VERSION,
    nodePath,
    cliPath,
    useBrowser: Boolean(useBrowser),
  });
  const launcherScript = buildMacLauncherScript({ nodePath, cliPath, useBrowser });

  let status = "installed";
  if (fs.existsSync(appPath)) {
    if (!fs.existsSync(markerPath)) {
      throw new Error(`Another application already exists at ${appPath}`);
    }
    status = fs.readFileSync(markerPath, "utf8") === desiredMarker ? "unchanged" : "updated";
  }

  if (!dryRun && status !== "unchanged") {
    fs.mkdirSync(applicationsDir, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(applicationsDir, ".kate-md-mac-"));
    const scriptPath = path.join(tmpDir, "launcher.js");
    const stagedAppPath = path.join(tmpDir, MAC_APP_NAME);
    try {
      fs.writeFileSync(scriptPath, launcherScript, "utf8");
      runMacCommand(runCommand, "osacompile", ["-l", "JavaScript", "-o", stagedAppPath, scriptPath]);

      const plistPath = path.join(stagedAppPath, "Contents", "Info.plist");
      patchMacInfoPlist(plistPath, runCommand);

      const stagedMarker = path.join(stagedAppPath, MAC_MARKER_REL);
      const resourcesDir = path.dirname(stagedMarker);
      fs.mkdirSync(resourcesDir, { recursive: true });
      const icnsPath = path.join(resourcesDir, MAC_ICON_FILENAME);
      if (iconPngPath) {
        runMacCommand(runCommand, "sips", ["-s", "format", "icns", iconPngPath, "--out", icnsPath]);
      } else {
        fs.copyFileSync(path.join(ASSETS_DIR, MAC_ICON_FILENAME), icnsPath);
      }
      fs.writeFileSync(stagedMarker, desiredMarker, "utf8");
      runMacCommand(runCommand, "codesign", ["--force", "--sign", "-", stagedAppPath]);

      const previousAppPath = path.join(tmpDir, "previous.app");
      if (status === "updated") fs.renameSync(appPath, previousAppPath);
      try {
        fs.renameSync(stagedAppPath, appPath);
      } catch (error) {
        if (status === "updated") fs.renameSync(previousAppPath, appPath);
        throw error;
      }

      try {
        runCommand(LSREGISTER_BIN, ["-f", appPath]);
      } catch {
        // best-effort Launch Services refresh
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return [
    {
      name: "macOS Finder Open With App",
      filePath: appPath,
      content: launcherScript,
      status,
    },
  ];
}

export function uninstallMacMenu({
  applicationsDir = getMacApplicationsDir(),
  dryRun = false,
  runCommand = defaultRunCommand,
} = {}) {
  const appPath = path.join(applicationsDir, MAC_APP_NAME);
  const markerPath = path.join(appPath, MAC_MARKER_REL);
  if (!fs.existsSync(appPath) || !fs.existsSync(markerPath)) {
    return [];
  }

  if (!dryRun) {
    try {
      runCommand(LSREGISTER_BIN, ["-u", appPath]);
    } catch {
      // best-effort unregister
    }
    fs.rmSync(appPath, { recursive: true, force: true });
  }
  return [appPath];
}

export function installSystemMenu(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "linux") return installLinuxMenu(options);
  if (platform === "win32") return installWindowsMenu(options);
  if (platform === "darwin") return installMacMenu(options);
  throw new Error(`Unsupported platform for install-menu: ${platform}`);
}

export function uninstallSystemMenu(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "linux") return uninstallLinuxMenu(options);
  if (platform === "win32") return uninstallWindowsMenu(options);
  if (platform === "darwin") return uninstallMacMenu(options);
  throw new Error(`Unsupported platform for uninstall-menu: ${platform}`);
}
