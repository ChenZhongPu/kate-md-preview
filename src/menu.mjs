import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveStableNodePath } from "./kate.mjs";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "assets");
const DEFAULT_ICON_SVG = path.join(ASSETS_DIR, "icon.svg");

const OPEN_WITH_FILENAME = "kate-md-preview-open.desktop";
const DOLPHIN_MENU_FILENAME = "kate-md-preview.desktop";
const CHROME_APP_ID = "chrome-127.0.0.1__kate-md-preview-Default";

const WINDOWS_EXTENSIONS = [".md", ".markdown"];
const WINDOWS_OPEN_WITH_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd"];
const WINDOWS_MENU_KEY = "kate-md-preview";
const WINDOWS_LABEL = "Markdown Preview";
const WINDOWS_ICON_FILENAME = "kate-md-preview.ico";
const WINDOWS_EXE_FILENAME = "kate-md-preview.exe";
const WINDOWS_EXE_MARKER_FILENAME = "launcher.json";
const WINDOWS_EXE_LAUNCHER_VERSION = 1;
const WINDOWS_PROG_ID = "KateMdPreview.Markdown";
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

function asciiEscapeJsonString(value) {
  // Keep generated Windows scripts / C# literals pure ASCII so ANSI code pages never corrupt Unicode paths.
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export function findWindowsCsc({ env = process.env, existsSync = fs.existsSync } = {}) {
  const systemRoot = env.SystemRoot || "C:\\Windows";
  const candidates = [
    path.win32.join(systemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.win32.join(systemRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
  const prefix = asciiEscapeJsonString(`"${cliPath}" ${modeFlag} "`);
  return [
    "if (WScript.Arguments.length > 0) {",
    '  var shell = new ActiveXObject("Shell.Application");',
    `  var args = ${prefix} + WScript.Arguments.Item(0) + '"';`,
    `  shell.ShellExecute(${asciiEscapeJsonString(nodePath)}, args, "", "open", 0);`,
    "}",
    "",
  ].join("\r\n");
}

export function buildWindowsLauncherCSharp({ nodePath, cliPath, useBrowser = false } = {}) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  return [
    "using System;",
    "using System.Diagnostics;",
    "using System.Reflection;",
    "using System.Text;",
    "",
    `[assembly: AssemblyTitle(${asciiEscapeJsonString(WINDOWS_LABEL)})]`,
    '[assembly: AssemblyDescription("Local GitHub-style Markdown live preview")]',
    '[assembly: AssemblyProduct("kate-md-preview")]',
    "",
    "internal static class Program",
    "{",
    "    private static string QuoteArg(string arg)",
    "    {",
    "        var sb = new StringBuilder();",
    "        sb.Append('\"');",
    "        int backslashes = 0;",
    "        for (int i = 0; i < arg.Length; i++)",
    "        {",
    "            char c = arg[i];",
    "            if (c == '\\\\')",
    "            {",
    "                backslashes++;",
    "            }",
    "            else if (c == '\"')",
    "            {",
    "                sb.Append('\\\\', backslashes * 2 + 1);",
    "                sb.Append('\"');",
    "                backslashes = 0;",
    "            }",
    "            else",
    "            {",
    "                if (backslashes > 0)",
    "                {",
    "                    sb.Append('\\\\', backslashes);",
    "                    backslashes = 0;",
    "                }",
    "                sb.Append(c);",
    "            }",
    "        }",
    "        if (backslashes > 0) sb.Append('\\\\', backslashes * 2);",
    "        sb.Append('\"');",
    "        return sb.ToString();",
    "    }",
    "",
    "    [STAThread]",
    "    private static void Main(string[] args)",
    "    {",
    "        if (args.Length == 0) return;",
    `        string nodePath = ${asciiEscapeJsonString(nodePath)};`,
    `        string cliPath = ${asciiEscapeJsonString(cliPath)};`,
    `        string modeFlag = ${asciiEscapeJsonString(modeFlag)};`,
    "        foreach (string target in args)",
    "        {",
    "            if (string.IsNullOrEmpty(target)) continue;",
    "            var psi = new ProcessStartInfo();",
    "            psi.FileName = nodePath;",
    '            psi.Arguments = QuoteArg(cliPath) + " " + modeFlag + " " + QuoteArg(target);',
    "            psi.UseShellExecute = false;",
    "            psi.CreateNoWindow = true;",
    "            psi.WindowStyle = ProcessWindowStyle.Hidden;",
    "            try { Process.Start(psi); } catch { }",
    "        }",
    "    }",
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
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let status = "installed";
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    const currentMode = mode != null ? fs.statSync(filePath).mode & 0o777 : null;
    status = existing.equals(data) && (mode == null || currentMode === mode) ? "unchanged" : "updated";
  }
  if (!dryRun && status !== "unchanged") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (mode != null) {
      fs.writeFileSync(filePath, data, { mode });
      try {
        fs.chmodSync(filePath, mode);
      } catch {
        // ignore chmod on non-POSIX filesystems
      }
    } else {
      fs.writeFileSync(filePath, data);
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

export function getWindowsOpenWithKeys() {
  const progIdKey = `HKCU\\Software\\Classes\\${WINDOWS_PROG_ID}`;
  const appKey = `HKCU\\Software\\Classes\\Applications\\${WINDOWS_EXE_FILENAME}`;
  return {
    progId: WINDOWS_PROG_ID,
    progIdKey,
    progIdAppKey: `${progIdKey}\\Application`,
    progIdIconKey: `${progIdKey}\\DefaultIcon`,
    progIdOpenKey: `${progIdKey}\\shell\\open`,
    progIdCommandKey: `${progIdKey}\\shell\\open\\command`,
    appKey,
    appIconKey: `${appKey}\\DefaultIcon`,
    appCommandKey: `${appKey}\\shell\\open\\command`,
    appSupportedTypesKey: `${appKey}\\SupportedTypes`,
    openWithProgidsKeys: WINDOWS_OPEN_WITH_EXTENSIONS.map((ext) => ({
      ext,
      key: `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`,
    })),
  };
}

function writeWindowsRegistryValue(runCommand, key, valueOptions, value) {
  const result = runCommand("reg", ["add", key, ...valueOptions, "/t", "REG_SZ", "/d", value, "/f"]);
  if (result?.status !== 0) {
    throw new Error(
      `Failed to write registry key ${key}: ${result?.stderr || result?.stdout || result?.error?.message || "unknown error"}`
    );
  }
}

function queryWindowsRegistryValue(runCommand, key, valueOptions) {
  return runCommand("reg", ["query", key, ...valueOptions]);
}

function ensureWindowsRegistryValue(runCommand, key, valueOptions, value) {
  const existing = queryWindowsRegistryValue(runCommand, key, valueOptions);
  const exists = existing?.status === 0;
  if (exists && (value === "" || String(existing.stdout || "").includes(value))) {
    return "unchanged";
  }
  writeWindowsRegistryValue(runCommand, key, valueOptions, value);
  return exists ? "updated" : "installed";
}

function deleteWindowsRegistryKey(runCommand, key, { dryRun = false } = {}) {
  const query = runCommand("reg", ["query", key]);
  if (query?.status !== 0) return false;
  if (!dryRun) {
    const result = runCommand("reg", ["delete", key, "/f"]);
    if (result?.status !== 0) {
      throw new Error(
        `Failed to delete registry key ${key}: ${result?.stderr || result?.stdout || result?.error?.message || "unknown error"}`
      );
    }
  }
  return true;
}

function deleteWindowsRegistryValue(runCommand, key, valueName, { dryRun = false } = {}) {
  const query = runCommand("reg", ["query", key, "/v", valueName]);
  if (query?.status !== 0) return false;
  if (!dryRun) {
    const result = runCommand("reg", ["delete", key, "/v", valueName, "/f"]);
    if (result?.status !== 0) {
      throw new Error(
        `Failed to delete registry value ${key}\\${valueName}: ${result?.stderr || result?.stdout || result?.error?.message || "unknown error"}`
      );
    }
  }
  return true;
}

function tryBuildWindowsExeLauncher({
  cscPath,
  menuDir,
  iconPath,
  iconHash,
  nodePath,
  cliPath,
  useBrowser,
  dryRun,
  runCommand,
}) {
  if (!cscPath) return null;

  const exePath = path.join(menuDir, WINDOWS_EXE_FILENAME);
  const markerPath = path.join(menuDir, WINDOWS_EXE_MARKER_FILENAME);
  const desiredMarker = JSON.stringify({
    managedBy: "kate-md-preview",
    launcherVersion: WINDOWS_EXE_LAUNCHER_VERSION,
    nodePath,
    cliPath,
    useBrowser: Boolean(useBrowser),
    iconHash,
  });
  const csSource = buildWindowsLauncherCSharp({ nodePath, cliPath, useBrowser });

  let status = "installed";
  if (fs.existsSync(exePath)) {
    status =
      fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === desiredMarker
        ? "unchanged"
        : "updated";
  }

  if (dryRun || status === "unchanged") {
    return { exePath, markerPath, csSource, status };
  }

  fs.mkdirSync(menuDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(menuDir, ".kate-md-win-"));
  const csPath = path.join(tmpDir, "launcher.cs");
  const stagedExePath = path.join(tmpDir, WINDOWS_EXE_FILENAME);
  try {
    fs.writeFileSync(csPath, csSource, "utf8");
    const cscArgs = [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      `/win32icon:${iconPath}`,
      `/out:${stagedExePath}`,
      csPath,
    ];
    const compiled = runCommand(cscPath, cscArgs);
    if (compiled?.status !== 0 || !fs.existsSync(stagedExePath)) {
      return null;
    }

    const previousExePath = path.join(tmpDir, "previous.exe");
    const hadPrevious = fs.existsSync(exePath);
    if (hadPrevious) fs.renameSync(exePath, previousExePath);
    try {
      fs.renameSync(stagedExePath, exePath);
    } catch (error) {
      if (hadPrevious && fs.existsSync(previousExePath)) {
        try {
          fs.renameSync(previousExePath, exePath);
        } catch {
          // ignore restore failure
        }
      }
      return null;
    }
    fs.writeFileSync(markerPath, desiredMarker, "utf8");
    return { exePath, markerPath, csSource, status };
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function removeWindowsOpenWithRegistry(runCommand, { dryRun = false } = {}) {
  const removed = [];
  const ow = getWindowsOpenWithKeys();

  for (const { key } of ow.openWithProgidsKeys) {
    if (deleteWindowsRegistryValue(runCommand, key, ow.progId, { dryRun })) {
      removed.push(`${key}\\${ow.progId}`);
    }
  }
  if (deleteWindowsRegistryKey(runCommand, ow.progIdKey, { dryRun })) {
    removed.push(ow.progIdKey);
  }
  if (deleteWindowsRegistryKey(runCommand, ow.appKey, { dryRun })) {
    removed.push(ow.appKey);
  }
  return removed;
}

export function installWindowsMenu({
  cliPath,
  nodePath = resolveStableNodePath(),
  menuDir = getWindowsMenuDir(),
  useBrowser = false,
  dryRun = false,
  runCommand = defaultRunCommand,
  cscPath = findWindowsCsc(),
} = {}) {
  const results = [];

  const iconPath = path.resolve(menuDir, WINDOWS_ICON_FILENAME);
  const iconContent = fs.readFileSync(path.join(ASSETS_DIR, WINDOWS_ICON_FILENAME));
  const iconHash = crypto.createHash("sha256").update(iconContent).digest("hex");
  const iconStatus = writeIdempotent(iconPath, iconContent, { dryRun, mode: null });

  const exeBuilt = tryBuildWindowsExeLauncher({
    cscPath,
    menuDir,
    iconPath,
    iconHash,
    nodePath,
    cliPath,
    useBrowser,
    dryRun,
    runCommand,
  });

  const useExe = Boolean(exeBuilt);
  let commandValue;
  if (useExe) {
    results.push({
      name: "Windows Native Launcher",
      filePath: exeBuilt.exePath,
      content: exeBuilt.csSource,
      status: exeBuilt.status,
    });
    results.push({ name: "Windows Context Menu Icon", filePath: iconPath, status: iconStatus });
    commandValue = `"${exeBuilt.exePath}" "%1"`;
  } else {
    const launcherPath = path.join(menuDir, WINDOWS_LAUNCHER);
    const launcherContent = buildWindowsLauncherScript({ nodePath, cliPath, useBrowser });
    const launcherStatus = writeIdempotent(launcherPath, launcherContent, { dryRun, mode: null });
    results.push({
      name: "Windows Silent Launcher",
      filePath: launcherPath,
      content: launcherContent,
      status: launcherStatus,
    });
    results.push({ name: "Windows Context Menu Icon", filePath: iconPath, status: iconStatus });
    const wscriptPath = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
    commandValue = `"${wscriptPath}" //E:JScript "${launcherPath}" "%1"`;
  }

  const iconValue = `"${iconPath}",0`;
  for (const { ext, shellKey, commandKey } of getWindowsRegistryKeys()) {
    let status = "installed";
    if (!dryRun) {
      const existingCmd = runCommand("reg", ["query", commandKey, "/ve"]);
      const existingIcon = runCommand("reg", ["query", shellKey, "/v", "Icon"]);
      const commandMatches =
        existingCmd?.status === 0 &&
        String(existingCmd.stdout || "").includes(commandValue);
      const iconMatches =
        existingIcon?.status === 0 &&
        String(existingIcon.stdout || "").includes(iconValue);
      if (!commandMatches) {
        writeWindowsRegistryValue(runCommand, shellKey, ["/ve"], WINDOWS_LABEL);
        writeWindowsRegistryValue(runCommand, commandKey, ["/ve"], commandValue);
      }
      if (!iconMatches) {
        writeWindowsRegistryValue(runCommand, shellKey, ["/v", "Icon"], iconValue);
      }
      if (existingCmd?.status === 0) status = commandMatches && iconMatches ? "unchanged" : "updated";
    }
    results.push({
      name: `Windows Explorer (${ext})`,
      filePath: shellKey,
      content: commandValue,
      status,
    });
  }

  if (useExe) {
    const ow = getWindowsOpenWithKeys();
    const exeIconValue = `"${exeBuilt.exePath}",0`;
    let openWithStatus = "installed";
    if (!dryRun) {
      const statuses = [
        ensureWindowsRegistryValue(runCommand, ow.progIdKey, ["/ve"], "Markdown Document"),
        ensureWindowsRegistryValue(runCommand, ow.progIdKey, ["/v", "FriendlyTypeName"], "Markdown Document"),
        ensureWindowsRegistryValue(runCommand, ow.progIdAppKey, ["/v", "ApplicationName"], WINDOWS_LABEL),
        ensureWindowsRegistryValue(runCommand, ow.progIdAppKey, ["/v", "ApplicationIcon"], exeIconValue),
        ensureWindowsRegistryValue(runCommand, ow.progIdIconKey, ["/ve"], iconValue),
        ensureWindowsRegistryValue(runCommand, ow.progIdOpenKey, ["/v", "FriendlyAppName"], WINDOWS_LABEL),
        ensureWindowsRegistryValue(runCommand, ow.progIdOpenKey, ["/v", "Icon"], exeIconValue),
        ensureWindowsRegistryValue(runCommand, ow.progIdCommandKey, ["/ve"], commandValue),
        ensureWindowsRegistryValue(runCommand, ow.appKey, ["/v", "FriendlyAppName"], WINDOWS_LABEL),
        ensureWindowsRegistryValue(runCommand, ow.appKey, ["/v", "ApplicationIcon"], exeIconValue),
        ensureWindowsRegistryValue(runCommand, ow.appIconKey, ["/ve"], exeIconValue),
        ensureWindowsRegistryValue(runCommand, ow.appCommandKey, ["/ve"], commandValue),
        ...WINDOWS_OPEN_WITH_EXTENSIONS.map((ext) =>
          ensureWindowsRegistryValue(runCommand, ow.appSupportedTypesKey, ["/v", ext], "")
        ),
        ...ow.openWithProgidsKeys.map(({ key }) =>
          ensureWindowsRegistryValue(runCommand, key, ["/v", ow.progId], "")
        ),
      ];
      if (statuses.every((s) => s === "unchanged")) openWithStatus = "unchanged";
      else if (statuses.some((s) => s === "updated" || s === "unchanged")) openWithStatus = "updated";
    }
    results.push({
      name: "Windows Open With",
      filePath: ow.progIdKey,
      content: commandValue,
      status: openWithStatus,
    });
  }

  if (!dryRun) {
    fs.rmSync(path.join(menuDir, LEGACY_WINDOWS_LAUNCHER), { force: true });
    if (useExe) {
      fs.rmSync(path.join(menuDir, WINDOWS_LAUNCHER), { force: true });
    } else {
      // If we fell back to JScript after a previous exe install, remove stale Open With entries.
      try {
        removeWindowsOpenWithRegistry(runCommand, { dryRun: false });
      } catch {
        // best-effort cleanup of stale Open With entries during fallback
      }
      fs.rmSync(path.join(menuDir, WINDOWS_EXE_FILENAME), { force: true });
      fs.rmSync(path.join(menuDir, WINDOWS_EXE_MARKER_FILENAME), { force: true });
    }
    if (process.platform === "win32" && runCommand === defaultRunCommand && results.some((r) => r.status !== "unchanged")) {
      try {
        spawnSync(path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "ie4uinit.exe"), ["-show"], {
          stdio: "ignore",
        });
      } catch {
        // best-effort Explorer icon cache refresh
      }
    }
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
    if (deleteWindowsRegistryKey(runCommand, shellKey, { dryRun })) {
      removed.push(shellKey);
    }
  }

  removed.push(...removeWindowsOpenWithRegistry(runCommand, { dryRun }));

  for (const name of [
    WINDOWS_EXE_FILENAME,
    WINDOWS_EXE_MARKER_FILENAME,
    WINDOWS_LAUNCHER,
    LEGACY_WINDOWS_LAUNCHER,
    WINDOWS_ICON_FILENAME,
  ]) {
    const filePath = path.join(menuDir, name);
    if (!fs.existsSync(filePath)) continue;
    if (!dryRun) {
      fs.unlinkSync(filePath);
    }
    removed.push(filePath);
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
