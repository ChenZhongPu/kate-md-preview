import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DEFAULT_ICON_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets",
  "icon.svg"
);

const DESKTOP_ENTRY_FILENAME = "kate-md-preview.desktop";

const TOOL_FILES = [
  {
    filename: "Markdown%20Preview%20%28GitHub%29.ini",
    actionName: "externaltool_MarkdownPreviewGitHub",
    cmdname: "markdown-preview-github",
    name: "Markdown Preview (GitHub)",
    extraArgs: "",
  },
  {
    filename: "Markdown%20Preview%20%28GitHub%20App%20Window%29.ini",
    actionName: "externaltool_MarkdownPreviewGitHubApp",
    cmdname: "markdown-preview-github-app",
    name: "Markdown Preview (GitHub App Window)",
    extraArgs: "--app ",
  },
];

export function getKateExternalToolsDir(env = process.env) {
  const configRoot = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, "kate", "externaltools");
}

export function getApplicationsDir(env = process.env) {
  const dataRoot = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataRoot, "applications");
}

export function resolveStableNodePath(execPath = process.execPath, homeDir = os.homedir()) {
  // Prefer fnm's stable default alias so Node upgrades do not break Kate's .ini
  const fnmDefault = path.join(homeDir, ".local", "share", "fnm", "aliases", "default", "bin", "node");
  if (execPath.includes(`${path.sep}fnm${path.sep}`) && fs.existsSync(fnmDefault)) {
    return fnmDefault;
  }
  // Same for volta shim if present
  const voltaNode = path.join(homeDir, ".volta", "bin", "node");
  if (execPath.includes(`${path.sep}.volta${path.sep}`) && fs.existsSync(voltaNode)) {
    return voltaNode;
  }
  return execPath;
}

export function isEphemeralNpxPath(cliPath) {
  return cliPath.includes(`${path.sep}_npx${path.sep}`);
}

export function buildKateToolIni({ tool, nodePath, cliPath }) {
  return [
    "[General]",
    `actionName=${tool.actionName}`,
    `arguments="${cliPath}" ${tool.extraArgs}"%{Document:FilePath}"`,
    "category=Tools",
    `cmdname=${tool.cmdname}`,
    `executable=${nodePath}`,
    "icon=text-markdown",
    "mimetypes=text/markdown",
    `name=${tool.name}`,
    "output=Ignore",
    "reload=false",
    "save=CurrentDocument",
    "trigger=None",
    "workingDir=%{Document:Path}",
    "",
  ].join("\n");
}

export function buildDesktopEntry({ iconPath = DEFAULT_ICON_PATH } = {}) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Markdown Preview",
    "Comment=Local GitHub-style Markdown live preview",
    `Icon=${iconPath}`,
    "StartupWMClass=kate-md-preview",
    "NoDisplay=true",
    "",
  ].join("\n");
}

function writeIdempotent(filePath, content, { dryRun, mode }) {
  let status = "installed";
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    status = existing === content ? "unchanged" : "updated";
  }
  if (!dryRun && status !== "unchanged") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, { mode });
  }
  return status;
}

export function installKateTools({
  cliPath,
  nodePath = resolveStableNodePath(),
  toolsDir = getKateExternalToolsDir(),
  applicationsDir = process.platform === "linux" ? getApplicationsDir() : null,
  iconPath = DEFAULT_ICON_PATH,
  dryRun = false,
} = {}) {
  const results = [];
  for (const tool of TOOL_FILES) {
    const filePath = path.join(toolsDir, tool.filename);
    const content = buildKateToolIni({ tool, nodePath, cliPath });
    const status = writeIdempotent(filePath, content, { dryRun, mode: 0o600 });
    results.push({ name: tool.name, filePath, content, status });
  }

  if (applicationsDir) {
    const desktopPath = path.join(applicationsDir, DESKTOP_ENTRY_FILENAME);
    const desktopContent = buildDesktopEntry({ iconPath });
    const status = writeIdempotent(desktopPath, desktopContent, { dryRun, mode: 0o644 });
    results.push({
      name: "Desktop App Window Icon",
      filePath: desktopPath,
      content: desktopContent,
      status,
    });
  }

  return results;
}

export function uninstallKateTools({
  toolsDir = getKateExternalToolsDir(),
  applicationsDir = process.platform === "linux" ? getApplicationsDir() : null,
  dryRun = false,
} = {}) {
  const removed = [];
  for (const tool of TOOL_FILES) {
    const filePath = path.join(toolsDir, tool.filename);
    if (fs.existsSync(filePath)) {
      if (!dryRun) {
        fs.unlinkSync(filePath);
      }
      removed.push(filePath);
    }
  }

  if (applicationsDir) {
    const desktopPath = path.join(applicationsDir, DESKTOP_ENTRY_FILENAME);
    if (fs.existsSync(desktopPath)) {
      if (!dryRun) {
        fs.unlinkSync(desktopPath);
      }
      removed.push(desktopPath);
    }
  }

  return removed;
}
