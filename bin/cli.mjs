#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getStateFilePath, startServer } from "../src/server.mjs";
import { installKateTools, isEphemeralNpxPath, uninstallKateTools } from "../src/kate.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_SCRIPT = path.resolve(__dirname, "../src/server.mjs");

function printHelp() {
  console.log(`kate-md-preview v${pkg.version}
Standalone local GitHub-style Markdown live previewer (GFM, pele Mermaid, KaTeX)
with optional built-in KDE Kate External Tools integration.

Usage:
  kate-md-preview [options] <file.md>
  md-preview [options] <file.md>
  kate-md-preview install-kate [--dry-run]
  kate-md-preview uninstall-kate [--dry-run]

Options:
  --app             Open in a chromeless browser app window (Chrome/Chromium/Brave/Edge)
  --browser         Open in the system default browser (default)
  --no-open         Start server and print preview URL without opening a browser
  -f, --foreground  Run server in the foreground for this file (Ctrl+C to stop)
  --status          Show background preview daemon status
  --stop            Stop the background preview daemon
  -v, --version     Show version
  -h, --help        Show this help message

Environment:
  KATE_MD_PREVIEW_APP=1   Default to --app window mode`);
}

function readState() {
  const stateFile = getStateFilePath();
  try {
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

async function fetchHealth(state) {
  if (!state || !state.port) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800);
    const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

async function ensureServer() {
  const existing = readState();
  const health = await fetchHealth(existing);
  if (health) {
    if (health.version === pkg.version) {
      return existing;
    }
    // Package was upgraded while an older daemon was still running; restart cleanly.
    if (existing?.pid) {
      try {
        process.kill(existing.pid, "SIGTERM");
      } catch {
        // already stopped
      }
      const stopDeadline = Date.now() + 2000;
      while (Date.now() < stopDeadline) {
        await new Promise((r) => setTimeout(r, 60));
        if (!(await fetchHealth(existing))) break;
      }
    }
  }

  const stateFile = getStateFilePath();
  try {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  } catch {
    // ignore
  }

  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 80));
    const state = readState();
    if (await fetchHealth(state)) {
      return state;
    }
  }
  throw new Error("Timed out waiting for preview server to start");
}

function findInPath(executable) {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const full = path.join(dir, executable);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // continue
    }
  }
  return null;
}

function findAppBrowser() {
  if (process.platform === "darwin") {
    const macCandidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    for (const p of macCandidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  if (process.platform === "linux") {
    const linuxCandidates = [
      "google-chrome-stable",
      "google-chrome",
      "chromium",
      "chromium-browser",
      "brave-browser",
      "brave",
      "microsoft-edge",
      "microsoft-edge-stable",
    ];
    for (const name of linuxCandidates) {
      const found = findInPath(name);
      if (found) return found;
      const usrBin = `/usr/bin/${name}`;
      if (fs.existsSync(usrBin)) return usrBin;
    }
  }

  return null;
}

function openUrl(url, useAppWindow) {
  if (useAppWindow) {
    const browserBin = findAppBrowser();
    if (browserBin) {
      const appArgs =
        process.platform === "linux"
          ? ["--class=kate-md-preview", `--app=${url}`]
          : [`--app=${url}`];
      const child = spawn(browserBin, appArgs, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    }
  }

  let cmd;
  let args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    return;
  }
  if (args.includes("-v") || args.includes("--version")) {
    console.log(pkg.version);
    return;
  }

  const subcmd = args[0];
  if (subcmd === "install-kate") {
    const dryRun = args.includes("--dry-run");
    if (isEphemeralNpxPath(__filename)) {
      console.warn(
        "Warning: running from a temporary npx cache path. For persistent Kate bindings, install globally first: npm install -g kate-md-preview"
      );
    }
    const items = installKateTools({ cliPath: __filename, dryRun });
    let changed = 0;
    for (const item of items) {
      if (item.status === "unchanged") {
        console.log(`Unchanged: ${item.filePath}`);
      } else {
        changed++;
        const verb = dryRun
          ? item.status === "updated"
            ? "[dry-run] Would update"
            : "[dry-run] Would install"
          : item.status === "updated"
            ? "Updated"
            : "Installed";
        console.log(`${verb}: ${item.filePath}`);
      }
    }
    if (!dryRun && changed > 0) {
      console.log("Restart Kate to load the External Tools (Tools -> External Tools -> Tools).");
    } else if (!dryRun) {
      console.log("Kate External Tools are already up to date.");
    }
    return;
  }

  if (subcmd === "uninstall-kate") {
    const dryRun = args.includes("--dry-run");
    const removed = uninstallKateTools({ dryRun });
    if (removed.length === 0) {
      console.log("Already uninstalled (no Kate External Tool entries found).");
    } else {
      for (const f of removed) {
        console.log(`${dryRun ? "[dry-run] Would remove" : "Removed"}: ${f}`);
      }
      if (!dryRun) {
        console.log("Restart Kate if it is currently open.");
      }
    }
    return;
  }

  let useApp = process.env.KATE_MD_PREVIEW_APP === "1";
  let noOpen = false;
  let foreground = false;
  let stopDaemon = false;
  let showStatus = false;
  let fileArg = null;

  for (const arg of args) {
    if (arg === "--app") useApp = true;
    else if (arg === "--browser") useApp = false;
    else if (arg === "--no-open") noOpen = true;
    else if (arg === "-f" || arg === "--foreground") foreground = true;
    else if (arg === "--stop") stopDaemon = true;
    else if (arg === "--status") showStatus = true;
    else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else if (!fileArg) {
      fileArg = arg;
    }
  }

  if (showStatus) {
    const state = readState();
    const health = await fetchHealth(state);
    if (!health) {
      console.log("kate-md-preview daemon is not running.");
    } else {
      console.log(
        `Running (pid=${health.pid}, port=${state.port}, version=${health.version}, clients=${health.clients}, sessions=${health.sessions})`
      );
    }
    return;
  }

  if (stopDaemon) {
    const state = readState();
    if (state?.pid) {
      try {
        process.kill(state.pid, "SIGTERM");
        console.log(`Stopped kate-md-preview (pid ${state.pid})`);
      } catch {
        console.log("kate-md-preview daemon was not running.");
      }
    } else {
      console.log("kate-md-preview daemon is not running.");
    }
    return;
  }

  if (!fileArg) {
    printHelp();
    process.exit(1);
  }

  let absFile = path.resolve(fileArg);
  if (fs.existsSync(absFile) && fs.statSync(absFile).isDirectory()) {
    const readme = path.join(absFile, "README.md");
    if (fs.existsSync(readme)) absFile = readme;
  }
  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
    console.error(`File not found: ${absFile}`);
    process.exit(1);
  }

  if (foreground) {
    const instance = await startServer({ writeState: false, idleTimeoutMs: 0 });
    const url = instance.openFile(absFile);
    const launchUrl = useApp ? instance.openAppFile(absFile) : url;
    console.log(url);
    if (!noOpen) openUrl(launchUrl, useApp);
    process.on("SIGINT", instance.shutdown);
    process.on("SIGTERM", instance.shutdown);
    return;
  }

  const state = await ensureServer();
  const resp = await fetch(`http://127.0.0.1:${state.port}/api/open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Preview-Token": state.token,
    },
    body: JSON.stringify({ file: absFile }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to open preview: ${resp.status} ${errText}`);
  }

  const { url, appUrl } = await resp.json();
  console.log(url);

  if (!noOpen) {
    openUrl(useApp && appUrl ? appUrl : url, useApp);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
