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
import { createFormatter, supportsColor } from "../src/terminal.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_SCRIPT = path.resolve(__dirname, "../src/server.mjs");

const out = createFormatter({ color: supportsColor({ stream: process.stdout }) });
const errOut = createFormatter({ color: supportsColor({ stream: process.stderr }) });

function printHelp() {
  const cmd = (text) => out.cyan(text);
  const section = (text) => out.bold(text);
  const opt = (flag, desc) => `  ${out.cyan(flag.padEnd(18))}${desc}`;

  const arrow = out.glyphs.arrow;
  console.log([
    `${out.brand(`${out.bold("kate-md-preview")} ${out.dim(`v${pkg.version}`)}`)}`,
    `  ${out.dim("Local GitHub-style Markdown live previewer (GFM, pele Mermaid, KaTeX)")}`,
    "",
    section("Usage"),
    `  ${cmd("md-preview")} ${out.dim("[options]")} <file.md>`,
    `  ${cmd("kate-md-preview")} install-menu ${out.dim("[--browser] [--dry-run]")}`,
    `  ${cmd("kate-md-preview")} uninstall-menu ${out.dim("[--dry-run]")}`,
    `  ${cmd("kate-md-preview")} install-kate ${out.dim("[--dry-run]")}`,
    `  ${cmd("kate-md-preview")} uninstall-kate ${out.dim("[--dry-run]")}`,
    "",
    section("Options"),
    opt("--app[=TARGET]", `Open in an app window (Chromium ${arrow} Firefox ${arrow} Safari)`),
    `  ${"".padEnd(18)}${out.dim("Targets: auto, chrome, chromium, edge, brave, firefox, safari")}`,
    opt("--browser", "Open in the system default browser (default)"),
    opt("--no-open", "Start server and print raw preview URL without opening"),
    opt("-f, --foreground", "Run server in the foreground (Ctrl+C to stop)"),
    opt("--status", "Show background preview daemon status"),
    opt("--stop", "Stop the background preview daemon"),
    opt("-v, --version", "Show version"),
    opt("-h, --help", "Show this help message"),
    "",
    section("Environment"),
    `  ${out.cyan("KATE_MD_PREVIEW_APP")}=${out.dim("1|firefox|chrome|edge|brave|safari")}`,
    `  ${"".padEnd(18)}${out.dim("Default to --app window mode (or pin a browser)")}`,
  ].join("\n"));
}

function formatInstallItem(item, dryRun) {
  const fileText = out.dim(item.filePath);
  if (item.status === "unchanged") {
    return `  ${out.skip(`${out.dim("Unchanged:")} ${fileText}`)}`;
  }
  if (dryRun) {
    const label = item.status === "updated" ? "[dry-run] Would update:" : "[dry-run] Would install:";
    return `  ${out.dry(`${out.yellow(label)} ${fileText}`)}`;
  }
  if (item.status === "updated") {
    return `  ${out.update(`${out.cyan("Updated:")}   ${fileText}`)}`;
  }
  return `  ${out.ok(`${out.green("Installed:")} ${fileText}`)}`;
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
        errOut.warn(
          "running from a temporary npx cache path. For persistent Kate bindings, install globally first: npm install -g kate-md-preview"
        )
      );
    }
    const items = installKateTools({ cliPath: __filename, dryRun });
    let changed = 0;
    for (const item of items) {
      if (item.status !== "unchanged") changed++;
      console.log(formatInstallItem(item, dryRun));
    }
    if (!dryRun && changed > 0) {
      const arrow = out.glyphs.arrow;
      console.log("");
      console.log(out.ok(`Kate External Tools ready. Restart Kate to load them (Tools ${arrow} External Tools ${arrow} Tools).`));
    } else if (!dryRun) {
      console.log(out.skip(out.dim("Kate External Tools are already up to date.")));
    }
    return;
  }

  if (subcmd === "uninstall-kate") {
    const dryRun = args.includes("--dry-run");
    const removed = uninstallKateTools({ dryRun });
    if (removed.length === 0) {
      console.log(out.skip(out.dim("Already uninstalled (no Kate External Tool entries found).")));
    } else {
      for (const f of removed) {
        const line = dryRun
          ? `  ${out.dry(`${out.yellow("[dry-run] Would remove:")} ${out.dim(f)}`)}`
          : `  ${out.remove(`${out.yellow("Removed:")} ${out.dim(f)}`)}`;
        console.log(line);
      }
      if (!dryRun) {
        console.log("");
        console.log(out.note("Restart Kate if it is currently open."));
      }
    }
    return;
  }

  if (subcmd === "install-menu") {
    const dryRun = args.includes("--dry-run");
    const useBrowser = args.includes("--browser");
    if (isEphemeralNpxPath(__filename)) {
      console.warn(
        errOut.warn(
          "running from a temporary npx cache path. For persistent context-menu entries, install globally first: npm install -g kate-md-preview"
        )
      );
    }
    const items = installSystemMenu({ cliPath: __filename, useBrowser, dryRun });
    let changed = 0;
    for (const item of items) {
      if (item.status !== "unchanged") changed++;
      console.log(formatInstallItem(item, dryRun));
    }
    if (!dryRun && changed > 0) {
      console.log("");
      console.log(out.ok("Installed OS right-click menu integration for Markdown files."));
      if (process.platform === "win32" && !items.some((item) => item.name === "Windows Open With")) {
        console.log(
          out.note(
            '.NET csc.exe was unavailable or failed; fell back to the silent JScript launcher (find it under "Show more options" on Windows 11).'
          )
        );
      }
    } else if (!dryRun) {
      console.log(out.skip(out.dim("OS context menu entries are already up to date.")));
    }
    return;
  }

  if (subcmd === "uninstall-menu") {
    const dryRun = args.includes("--dry-run");
    const removed = uninstallSystemMenu({ dryRun });
    if (removed.length === 0) {
      console.log(out.skip(out.dim("Already uninstalled (no OS context menu entries found).")));
    } else {
      for (const f of removed) {
        const line = dryRun
          ? `  ${out.dry(`${out.yellow("[dry-run] Would remove:")} ${out.dim(f)}`)}`
          : `  ${out.remove(`${out.yellow("Removed:")} ${out.dim(f)}`)}`;
        console.log(line);
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
      console.error(errOut.err(`Unknown option: ${errOut.bold(arg)}`));
      process.exit(1);
    } else if (!fileArg) {
      fileArg = arg;
    }
  }

  if (showStatus) {
    const state = readState();
    const health = await fetchHealth(state);
    console.log(out.banner({ version: pkg.version, subtitle: "daemon status", active: Boolean(health) }));
    console.log("");
    if (!health) {
      console.log(`  ${out.idle(out.dim("kate-md-preview daemon is not running."))}`);
    } else {
      const details = [
        `${out.dim("pid=")}${out.bold(health.pid)}`,
        `${out.dim("port=")}${out.bold(state.port)}`,
        `${out.dim("version=")}${health.version}`,
        `${out.dim("clients=")}${health.clients}`,
        `${out.dim("sessions=")}${health.sessions}`,
      ].join(", ");
      console.log(`  ${out.active(`${out.bold("Running")} (${details})`)}`);
    }
    return;
  }

  if (stopDaemon) {
    const state = readState();
    if (state?.pid) {
      try {
        process.kill(state.pid, "SIGTERM");
        console.log(out.ok(`Stopped kate-md-preview ${out.dim(`(pid ${state.pid})`)}`));
      } catch {
        console.log(out.idle(out.dim("kate-md-preview daemon was not running.")));
      }
    } else {
      console.log(out.idle(out.dim("kate-md-preview daemon is not running.")));
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
    console.error(errOut.err(`File not found: ${errOut.dim(absFile)}`));
    process.exit(1);
  }

  const printPreviewUrl = (url, { isForeground = false } = {}) => {
    if (noOpen || !process.stdout.isTTY) {
      console.log(url);
      return;
    }
    if (isForeground) {
      console.log(out.banner({ version: pkg.version, subtitle: "foreground preview", active: true }));
      console.log("");
      console.log(`  ${out.active(`${out.bold("Preview")}  ${out.url(url)}`)}`);
      console.log(`    ${out.dim(`Watching for changes ${out.glyphs.sep} press Ctrl+C to stop`)}`);
      return;
    }
    console.log(out.active(`${out.bold("Preview")}  ${out.url(url)}`));
  };

  if (foreground) {
    const instance = await startServer({ writeState: false, idleTimeoutMs: 0 });
    const url = instance.openFile(absFile);
    const appUrl = instance.openAppFile(absFile);
    printPreviewUrl(url, { isForeground: true });
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
  printPreviewUrl(url);

  if (!noOpen) {
    await openPreviewUrl({ url, appUrl, appMode });
  }
}

main().catch((err) => {
  console.error(errOut.err(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
