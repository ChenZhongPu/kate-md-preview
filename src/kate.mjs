import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

export function installKateTools({
  cliPath,
  nodePath = resolveStableNodePath(),
  toolsDir = getKateExternalToolsDir(),
  dryRun = false,
} = {}) {
  const results = [];
  if (!dryRun) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }
  for (const tool of TOOL_FILES) {
    const filePath = path.join(toolsDir, tool.filename);
    const content = buildKateToolIni({ tool, nodePath, cliPath });
    let status = "installed";

    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, "utf8");
      status = existing === content ? "unchanged" : "updated";
    }

    if (!dryRun && status !== "unchanged") {
      fs.writeFileSync(filePath, content, { mode: 0o600 });
    }
    results.push({ name: tool.name, filePath, content, status });
  }
  return results;
}

export function uninstallKateTools({
  toolsDir = getKateExternalToolsDir(),
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
  return removed;
}
