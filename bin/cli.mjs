#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getStateFilePath, startServer } from "../src/server.mjs";
import { installKateTools, isEphemeralNpxPath, uninstallKateTools } from "../src/kate.mjs";
import { installSystemMenu, uninstallSystemMenu } from "../src/menu.mjs";
import { normalizeAppMode, openPreviewUrl } from "../src/browser.mjs";

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
  kate-md-preview install-menu [--browser] [--dry-run]
  kate-md-preview uninstall-menu [--dry-run]

Options:
  --app[=TARGET]    Open in an app window (auto: Chromium -> Firefox -> Safari on macOS)
                    Optional TARGET: auto, chrome, chromium, edge, brave, firefox, safari
  --browser         Open in the system default browser (default)
  --no-open         Start server and print preview URL without opening a browser
  -f, --foreground  Run server in the foreground for this file (Ctrl+C to stop)
  --status          Show background preview daemon status
  --stop            Stop the background preview daemon
  -v, --version     Show version
  -h, --help        Show this help message

Environment:
  KATE_MD_PREVIEW_APP=1|firefox|chrome|edge|brave|safari
                    Default to --app window mode (or pin a specific browser)`);
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
    windowsHide: true,
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

  if (subcmd === "install-menu") {
    const dryRun = args.includes("--dry-run");
    const useBrowser = args.includes("--browser");
    if (isEphemeralNpxPath(__filename)) {
      console.warn(
        "Warning: running from a temporary npx cache path. For persistent context-menu entries, install globally first: npm install -g kate-md-preview"
      );
    }
    const items = installSystemMenu({ cliPath: __filename, useBrowser, dryRun });
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
      console.log("Installed OS right-click menu integration for Markdown files.");
      if (process.platform === "win32" && !items.some((item) => item.name === "Windows Open With")) {
        console.log(
          'Note: .NET csc.exe was unavailable or failed; fell back to the silent JScript launcher (find it under "Show more options" on Windows 11).'
        );
      }
    } else if (!dryRun) {
      console.log("OS context menu entries are already up to date.");
    }
    return;
  }

  if (subcmd === "uninstall-menu") {
    const dryRun = args.includes("--dry-run");
    const removed = uninstallSystemMenu({ dryRun });
    if (removed.length === 0) {
      console.log("Already uninstalled (no OS context menu entries found).");
    } else {
      for (const f of removed) {
        console.log(`${dryRun ? "[dry-run] Would remove" : "Removed"}: ${f}`);
      }
    }
    return;
  }

  let appMode = normalizeAppMode(process.env.KATE_MD_PREVIEW_APP);
  let noOpen = false;
  let foreground = false;
  let stopDaemon = false;
  let showStatus = false;
  let fileArg = null;

  for (const arg of args) {
    if (arg === "--app") appMode = "auto";
    else if (arg.startsWith("--app=")) appMode = normalizeAppMode(arg.slice("--app=".length));
    else if (arg === "--browser") appMode = null;
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
    const appUrl = instance.openAppFile(absFile);
    console.log(url);
    process.on("SIGINT", instance.shutdown);
    process.on("SIGTERM", instance.shutdown);
    if (!noOpen) await openPreviewUrl({ url, appUrl, appMode });
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
    await openPreviewUrl({ url, appUrl, appMode });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
