import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveStableNodePath } from "./kate.mjs";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "assets");
const DEFAULT_ICON_SVG = path.join(ASSETS_DIR, "icon.svg");
const DEFAULT_ICON_PNG = path.join(ASSETS_DIR, "icon-256.png");

const OPEN_WITH_FILENAME = "kate-md-preview-open.desktop";
const DOLPHIN_MENU_FILENAME = "kate-md-preview.desktop";
const CHROME_APP_ID = "chrome-127.0.0.1__kate-md-preview-Default";

const WINDOWS_EXTENSIONS = [".md", ".markdown"];
const WINDOWS_MENU_KEY = "kate-md-preview";
const WINDOWS_LABEL = "Markdown Preview";

const MAC_APP_NAME = "Markdown Preview.app";
const MAC_BUNDLE_ID = "io.github.chenzhongpu.kate-md-preview";
const MAC_MARKER_REL = path.join("Contents", "Resources", "kate-md-preview.json");
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

function escapeShellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeVbsString(value) {
  return String(value).replace(/"/g, '""');
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

export function buildWindowsLauncherVbs({ nodePath, cliPath, useBrowser = false } = {}) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  const escapedNode = escapeVbsString(nodePath);
  const escapedCli = escapeVbsString(cliPath);
  return [
    "' Silent launcher for kate-md-preview (avoids flashing a console window)",
    "If WScript.Arguments.Count >= 1 Then",
    "  Dim shell, target, cmd",
    '  Set shell = CreateObject("WScript.Shell")',
    '  target = Replace(WScript.Arguments(0), """", """""")',
    `  cmd = """${escapedNode}"" ""${escapedCli}"" ${modeFlag} """ & target & """"`,
    "  shell.Run cmd, 0, False",
    "End If",
    "",
  ].join("\r\n");
}

export function buildMacAppleScript({ nodePath, cliPath, useBrowser = false } = {}) {
  const modeFlag = useBrowser ? "--browser" : "--app";
  const prefix = `${escapeShellSingleQuote(nodePath)} ${escapeShellSingleQuote(cliPath)} ${modeFlag} `;
  const escapedPrefix = escapeAppleScriptString(prefix);
  return [
    "on open theFiles",
    "  repeat with aFile in theFiles",
    "    set filePath to POSIX path of aFile",
    `    do shell script "${escapedPrefix}" & quoted form of filePath & " >/dev/null 2>&1 &"`,
    "  end repeat",
    "end open",
    "",
  ].join("\n");
}

export function buildMacDocumentTypesPlistXml() {
  return [
    "<array>",
    "  <dict>",
    "    <key>CFBundleTypeName</key>",
    "    <string>Markdown Document</string>",
    "    <key>CFBundleTypeRole</key>",
    "    <string>Viewer</string>",
    "    <key>LSHandlerRank</key>",
    "    <string>Alternate</string>",
    "    <key>CFBundleTypeExtensions</key>",
    "    <array>",
    "      <string>md</string>",
    "      <string>markdown</string>",
    "      <string>mdown</string>",
    "      <string>mkd</string>",
    "    </array>",
    "    <key>LSItemContentTypes</key>",
    "    <array>",
    "      <string>net.daringfireball.markdown</string>",
    "    </array>",
    "  </dict>",
    "</array>",
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
  const vbsPath = path.join(menuDir, "launch.vbs");
  const vbsContent = buildWindowsLauncherVbs({ nodePath, cliPath, useBrowser });
  const vbsStatus = writeIdempotent(vbsPath, vbsContent, { dryRun, mode: null });
  results.push({
    name: "Windows Silent Launcher",
    filePath: vbsPath,
    content: vbsContent,
    status: vbsStatus,
  });

  const commandValue = `wscript.exe "${vbsPath}" "%1"`;
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
        runCommand("reg", ["delete", shellKey, "/f"]);
      }
      removed.push(shellKey);
    }
  }

  const vbsPath = path.join(menuDir, "launch.vbs");
  if (fs.existsSync(vbsPath)) {
    if (!dryRun) {
      fs.unlinkSync(vbsPath);
    }
    removed.push(vbsPath);
  }

  return removed;
}

function tryBuildMacIcns(iconPngPath, targetIcnsPath, runCommand) {
  if (!fs.existsSync(iconPngPath)) return;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-icns-"));
  const iconsetDir = path.join(tmpRoot, "applet.iconset");
  try {
    fs.mkdirSync(iconsetDir, { recursive: true });
    const sizes = [
      [16, "icon_16x16.png"],
      [32, "icon_16x16@2x.png"],
      [32, "icon_32x32.png"],
      [64, "icon_32x32@2x.png"],
      [128, "icon_128x128.png"],
      [256, "icon_128x128@2x.png"],
      [256, "icon_256x256.png"],
    ];
    for (const [size, filename] of sizes) {
      const r = runCommand("sips", ["-z", String(size), String(size), iconPngPath, "--out", path.join(iconsetDir, filename)]);
      if (r?.status !== 0) return;
    }
    runCommand("iconutil", ["-c", "icns", iconsetDir, "-o", targetIcnsPath]);
  } catch {
    // best-effort icon conversion
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function patchMacInfoPlist(plistPath, runCommand) {
  // Update Info.plist cleanly via plutil XML conversion + standard XML manipulation
  const toXml = runCommand("plutil", ["-convert", "xml1", plistPath]);
  if (toXml?.status !== 0 || !fs.existsSync(plistPath)) return;

  let xml = fs.readFileSync(plistPath, "utf8");
  const upsertSimpleKey = (key, valueTag) => {
    const re = new RegExp(`<key>${key}</key>\\s*<[^>]+>(?:[\\s\\S]*?</[^>]+>)?`, "m");
    const replacement = `<key>${key}</key>\n\t${valueTag}`;
    if (re.test(xml)) {
      xml = xml.replace(re, replacement);
    } else {
      xml = xml.replace(/<\/dict>\s*<\/plist>/, `\t${replacement}\n</dict>\n</plist>`);
    }
  };

  upsertSimpleKey("CFBundleIdentifier", `<string>${MAC_BUNDLE_ID}</string>`);
  upsertSimpleKey("CFBundleName", "<string>Markdown Preview</string>");
  upsertSimpleKey("LSUIElement", "<true/>");

  const docTypesRe = /<key>CFBundleDocumentTypes<\/key>\s*<array>[\s\S]*?<\/array>/m;
  const docTypesBlock = `<key>CFBundleDocumentTypes</key>\n${buildMacDocumentTypesPlistXml()}`;
  if (docTypesRe.test(xml)) {
    xml = xml.replace(docTypesRe, docTypesBlock);
  } else {
    xml = xml.replace(/<\/dict>\s*<\/plist>/, `\t${docTypesBlock}\n</dict>\n</plist>`);
  }

  fs.writeFileSync(plistPath, xml, "utf8");
}

export function installMacMenu({
  cliPath,
  nodePath = resolveStableNodePath(),
  iconPngPath = DEFAULT_ICON_PNG,
  applicationsDir = getMacApplicationsDir(),
  useBrowser = false,
  dryRun = false,
  runCommand = defaultRunCommand,
} = {}) {
  const appPath = path.join(applicationsDir, MAC_APP_NAME);
  const markerPath = path.join(appPath, MAC_MARKER_REL);
  const desiredMarker = JSON.stringify({
    managedBy: "kate-md-preview",
    nodePath,
    cliPath,
    useBrowser: Boolean(useBrowser),
  });
  const appleScript = buildMacAppleScript({ nodePath, cliPath, useBrowser });

  let status = "installed";
  if (fs.existsSync(appPath)) {
    if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === desiredMarker) {
      status = "unchanged";
    } else {
      status = "updated";
    }
  }

  if (!dryRun && status !== "unchanged") {
    fs.mkdirSync(applicationsDir, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-mac-"));
    const scriptPath = path.join(tmpDir, "launcher.applescript");
    const stagedAppPath = path.join(tmpDir, MAC_APP_NAME);
    try {
      fs.writeFileSync(scriptPath, appleScript, "utf8");
      const compiled = runCommand("osacompile", ["-o", stagedAppPath, scriptPath]);
      if (compiled?.status !== 0) {
        throw new Error(
          `osacompile failed: ${compiled?.stderr || compiled?.stdout || "unknown error"}`
        );
      }

      const plistPath = path.join(stagedAppPath, "Contents", "Info.plist");
      patchMacInfoPlist(plistPath, runCommand);

      const icnsPath = path.join(stagedAppPath, "Contents", "Resources", "applet.icns");
      tryBuildMacIcns(iconPngPath, icnsPath, runCommand);

      const stagedMarker = path.join(stagedAppPath, MAC_MARKER_REL);
      fs.mkdirSync(path.dirname(stagedMarker), { recursive: true });
      fs.writeFileSync(stagedMarker, desiredMarker, "utf8");

      if (fs.existsSync(appPath)) {
        fs.rmSync(appPath, { recursive: true, force: true });
      }
      fs.cpSync(stagedAppPath, appPath, { recursive: true });

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
      content: appleScript,
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
