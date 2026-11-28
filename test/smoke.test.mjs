import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { renderMarkdown } from "../src/renderer.mjs";
import { startServer } from "../src/server.mjs";
import { installKateTools, uninstallKateTools } from "../src/kate.mjs";
import {
  buildWindowsLauncherCSharp,
  getWindowsOpenWithKeys,
  getWindowsRegistryKeys,
  installLinuxMenu,
  installMacMenu,
  installWindowsMenu,
  uninstallLinuxMenu,
  uninstallMacMenu,
  uninstallWindowsMenu,
} from "../src/menu.mjs";
import {
  ensureFirefoxAppProfile,
  normalizeAppMode,
  resolveBrowserLaunch,
} from "../src/browser.mjs";
import { createFormatter, supportsColor, supportsUnicode } from "../src/terminal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../bin/cli.mjs");

test("renderer supports GitHub HTML centering, alerts, details, math, and pele Mermaid", () => {
  const md = [
    '<div align="center">',
    "",
    "# Demo Title",
    "",
    "[![badge](https://img.shields.io/badge/test-passing-green)](https://example.com)",
    "",
    "</div>",
    "",
    "> [!NOTE]",
    "> GitHub alert content.",
    "",
    "<details><summary>More</summary>Hidden body</details>",
    "",
    "Prices are $5 and $10, while $E = mc^2$ is inline math.",
    "",
    "$$",
    "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
    "$$",
    "",
    "```math",
    "a^2 + b^2 = c^2",
    "```",
    "",
    "```mermaid",
    "graph LR",
    "  A[Editor] --> B[pele]",
    "```",
    "",
    "```mermaid",
    "invalid @@@ diagram",
    "```",
    "",
    "## Repeat",
    "## Repeat",
  ].join("\n");

  const { html, title } = renderMarkdown(md);
  assert.equal(title, "Demo Title");
  assert.match(html, /<div align="center">/);
  assert.match(html, /<h1 id="demo-title">Demo Title<\/h1>/);
  assert.match(html, /markdown-alert-note/);
  assert.match(html, /<details><summary>More<\/summary>/);
  assert.match(html, /Prices are \$5 and \$10,/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="math-block"/);
  assert.match(html, /class="pele-mermaid-diagram".*<svg/s);
  assert.match(html, /class="pele-mermaid-error"/);
  assert.match(html, /id="repeat"/);
  assert.match(html, /id="repeat-1"/);
});

test("Kate installer and uninstaller are idempotent and preserve unrelated tools", () => {
  const tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-cfg-"));
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-data-"));
  const toolsDir = path.join(tmpConfig, "kate", "externaltools");
  const applicationsDir = path.join(tmpData, "applications");
  const unrelated = path.join(toolsDir, "Unrelated.ini");

  try {
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(unrelated, "[General]\nname=Unrelated\n");

    // 1st install: creates both .ini entries + Chromium & Firefox hidden .desktop entries
    const first = installKateTools({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      toolsDir,
      applicationsDir,
    });
    assert.equal(first.length, 4);
    assert.ok(first.every((item) => item.status === "installed"));
    for (const item of first.slice(0, 2)) {
      assert.ok(fs.existsSync(item.filePath));
      const text = fs.readFileSync(item.filePath, "utf8");
      assert.match(text, /^executable=\/usr\/bin\/node$/m);
      assert.match(text, /%\{Document:FilePath\}/);
    }
    const chromeDesktopText = fs.readFileSync(first[2].filePath, "utf8");
    assert.match(first[2].filePath, /chrome-127\.0\.0\.1__kate-md-preview-Default\.desktop$/);
    assert.match(chromeDesktopText, /^StartupWMClass=chrome-127\.0\.0\.1__kate-md-preview-Default$/m);
    assert.match(chromeDesktopText, /^NoDisplay=true$/m);
    assert.match(chromeDesktopText, /icon\.svg$/m);

    const ffDesktopText = fs.readFileSync(first[3].filePath, "utf8");
    assert.match(first[3].filePath, /kate-md-preview\.desktop$/);
    assert.match(ffDesktopText, /^StartupWMClass=kate-md-preview$/m);
    assert.match(ffDesktopText, /^NoDisplay=true$/m);

    // 2nd install: idempotent (unchanged, does not rewrite)
    const mtimeBefore = fs.statSync(first[0].filePath).mtimeMs;
    const second = installKateTools({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      toolsDir,
      applicationsDir,
    });
    assert.ok(second.every((item) => item.status === "unchanged"));
    assert.equal(fs.statSync(first[0].filePath).mtimeMs, mtimeBefore);

    // Modify one entry -> re-install updates only the changed file
    fs.writeFileSync(first[0].filePath, "[General]\nname=Stale\n");
    const third = installKateTools({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      toolsDir,
      applicationsDir,
    });
    assert.equal(third[0].status, "updated");
    assert.equal(third[1].status, "unchanged");
    assert.equal(third[2].status, "unchanged");
    assert.equal(third[3].status, "unchanged");

    // CLI install-kate / uninstall-kate repeated runs exit 0 cleanly
    const env = { ...process.env, XDG_CONFIG_HOME: tmpConfig, XDG_DATA_HOME: tmpData };
    const cliInstall1 = execFileSync(process.execPath, [CLI_PATH, "install-kate"], {
      env,
      encoding: "utf8",
    });
    assert.match(cliInstall1, /Updated:|Installed:/);
    const cliInstall2 = execFileSync(process.execPath, [CLI_PATH, "install-kate"], {
      env,
      encoding: "utf8",
    });
    assert.match(cliInstall2, /already up to date/);

    const cliUninstall1 = execFileSync(process.execPath, [CLI_PATH, "uninstall-kate"], {
      env,
      encoding: "utf8",
    });
    assert.match(cliUninstall1, /Removed:/);
    assert.equal(fs.existsSync(first[2].filePath), process.platform !== "linux");
    const cliUninstall2 = execFileSync(process.execPath, [CLI_PATH, "uninstall-kate"], {
      env,
      encoding: "utf8",
    });
    assert.match(cliUninstall2, /Already uninstalled/);

    assert.ok(fs.existsSync(unrelated), "unrelated Kate tool must remain intact");
  } finally {
    fs.rmSync(tmpConfig, { recursive: true, force: true });
    fs.rmSync(tmpData, { recursive: true, force: true });
  }
});

test("HTTP server serves rendered markdown, assets, fragments, and blocks path traversal", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-doc-"));
  const mdFile = path.join(tmpDir, "README.md");
  const siblingFile = path.join(tmpDir, "OTHER.md");
  fs.writeFileSync(mdFile, "# Hello\n\nSee [Other](OTHER.md).\n");
  fs.writeFileSync(siblingFile, "# Other\n");

  const instance = await startServer({ port: 0, writeState: false, idleTimeoutMs: 0 });
  try {
    const url = instance.openFile(mdFile);
    const parsed = new URL(url);
    const origin = parsed.origin;

    const pageResp = await fetch(url);
    assert.equal(pageResp.status, 200);
    const pageHtml = await pageResp.text();
    assert.match(pageHtml, /<h1 id="hello">Hello<\/h1>/);
    assert.match(pageHtml, /href="\/assets\/icon-256\.png"/);
    assert.match(pageHtml, /href="\/manifest\.webmanifest"/);
    assert.match(pageHtml, /id="meta-toggle"[^>]*aria-expanded="false"/);
    assert.match(pageHtml, new RegExp(`id="server-meta-pill"[^>]*hidden>[\\s\\S]*port <strong>${instance.port}<\\/strong>[\\s\\S]*pid <strong>${process.pid}<\\/strong>`));
    assert.match(pageHtml, /id="theme-switch"[^>]*role="radiogroup"/);
    assert.match(pageHtml, /data-theme-opt="auto"/);
    assert.match(pageHtml, /data-theme-opt="light"/);
    assert.match(pageHtml, /data-theme-opt="dark"/);
    assert.match(pageHtml, /id="width-toggle"[^>]*aria-pressed="false"/);
    assert.match(pageHtml, /id="outline-toggle"[^>]*aria-expanded="false"/);
    assert.match(pageHtml, /id="outline-close"/);
    assert.match(pageHtml, /id="outline-panel"[^>]*hidden/);
    assert.match(pageHtml, /id="zoom-control"/);
    assert.match(pageHtml, /id="zoom-out"/);
    assert.match(pageHtml, /id="zoom-reset"[^>]*>100%<\/button>/);
    assert.match(pageHtml, /id="zoom-in"/);

    const siblingResp = await fetch(`${origin}${path.posix.dirname(parsed.pathname)}/OTHER.md`);
    assert.equal(siblingResp.status, 200);
    assert.match(await siblingResp.text(), /<h1 id="other">Other<\/h1>/);

    const cssResp = await fetch(`${origin}/assets/github-markdown-light.css`);
    assert.equal(cssResp.status, 200);

    const katexResp = await fetch(`${origin}/assets/katex/katex.min.css`);
    assert.equal(katexResp.status, 200);

    const iconPngResp = await fetch(`${origin}/assets/icon-256.png`);
    assert.equal(iconPngResp.status, 200);
    assert.equal(iconPngResp.headers.get("content-type"), "image/png");

    const iconSvgResp = await fetch(`${origin}/assets/icon.svg`);
    assert.equal(iconSvgResp.status, 200);
    assert.equal(iconSvgResp.headers.get("content-type"), "image/svg+xml");

    const faviconResp = await fetch(`${origin}/favicon.ico`);
    assert.equal(faviconResp.status, 200);
    assert.equal(faviconResp.headers.get("content-type"), "image/x-icon");
    const faviconBytes = Buffer.from(await faviconResp.arrayBuffer());
    assert.equal(faviconBytes.readUInt16LE(2), 1, "/favicon.ico must be a real ICO image");

    const manifestResp = await fetch(`${origin}/manifest.webmanifest`);
    assert.equal(manifestResp.status, 200);
    const manifest = await manifestResp.json();
    assert.equal(manifest.icons[0].sizes, "256x256");

    const appUrl = instance.openAppFile(mdFile);
    assert.match(appUrl, /\/kate-md-preview\?target=%2Fs%2F/);
    const appResp = await fetch(appUrl);
    assert.equal(appResp.status, 200);
    assert.match(await appResp.text(), /window\.location\.replace\("\/s\//);

    const badAppResp = await fetch(`${origin}/kate-md-preview?target=https://evil.example`);
    assert.equal(badAppResp.status, 400);

    const escapeResp = await fetch(`${origin}${path.posix.dirname(parsed.pathname)}/..%2F..%2Fetc%2Fpasswd`);
    assert.equal(escapeResp.status, 404);

    const unauthOpen = await fetch(`${origin}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: mdFile }),
    });
    assert.equal(unauthOpen.status, 403);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI starts and stops an isolated daemon from an install path with spaces", () => {
  const tmpRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-run-"));
  const tmpDocDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-cli-"));
  const mdFile = path.join(tmpDocDir, "sample.md");
  fs.writeFileSync(mdFile, "# CLI Test\n");
  const env = { ...process.env, XDG_RUNTIME_DIR: tmpRuntime };

  try {
    const packageRoot = path.resolve(__dirname, "..");
    const installDir = path.join(tmpRuntime, "Markdown Preview");
    for (const entry of ["bin", "src", "package.json"]) {
      fs.cpSync(path.join(packageRoot, entry), path.join(installDir, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(packageRoot, "node_modules"), path.join(installDir, "node_modules"), "junction");
    const cliPath = path.join(installDir, "bin", "cli.mjs");

    const urlOut = execFileSync(process.execPath, [cliPath, "--no-open", mdFile], {
      env,
      encoding: "utf8",
    }).trim();
    assert.match(urlOut, /^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]+\/sample\.md$/);

    const statusOut = execFileSync(process.execPath, [cliPath, "--status"], {
      env,
      encoding: "utf8",
    });
    assert.match(statusOut, /Running \(pid=\d+/);

    const stopOut = execFileSync(process.execPath, [cliPath, "--stop"], {
      env,
      encoding: "utf8",
    });
    assert.match(stopOut, /Stopped kate-md-preview/);
  } finally {
    fs.rmSync(tmpRuntime, { recursive: true, force: true });
    fs.rmSync(tmpDocDir, { recursive: true, force: true });
  }
});

test("browser launcher resolves Windows Edge, Firefox chromeless profile, and macOS Safari", () => {
  assert.equal(normalizeAppMode("1"), "auto");
  assert.equal(normalizeAppMode("Firefox"), "firefox");
  assert.equal(normalizeAppMode("0"), null);
  assert.throws(() => normalizeAppMode("unknown-browser"), /Invalid --app target/);

  const url = "http://127.0.0.1:41234/s/abc/README.md";
  const appUrl = "http://127.0.0.1:41234/kate-md-preview?target=%2Fs%2Fabc%2FREADME.md";

  // Windows: detects preinstalled Microsoft Edge for --app
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const winLaunch = resolveBrowserLaunch({
    url,
    appUrl,
    appMode: "auto",
    platform: "win32",
    env: { "PROGRAMFILES(X86)": "C:\\Program Files (x86)" },
    existsSync: (p) => p === edgePath,
    findInPath: () => null,
  });
  assert.equal(winLaunch.kind, "chromium");
  assert.equal(winLaunch.cmd, edgePath);
  assert.deepEqual(winLaunch.args, [`--app=${appUrl}`]);

  const programFiles = "C:\\Program Files";
  const chromePath = path.win32.join(programFiles, "Google\\Chrome\\Application\\chrome.exe");
  const chromiumPath = path.win32.join(programFiles, "Chromium\\Application\\chrome.exe");
  const winOptions = {
    url: "http://127.0.0.1:41234/s/abc/%E4%B8%AD%20O'Connor.md",
    platform: "win32",
    env: { PROGRAMFILES: programFiles },
    findInPath: () => null,
  };
  const chromium = resolveBrowserLaunch({
    ...winOptions,
    appMode: "chromium",
    existsSync: (p) => [chromePath, chromiumPath].includes(p),
  });
  assert.equal(chromium.cmd, chromiumPath);
  assert.throws(() => resolveBrowserLaunch({
    ...winOptions,
    appMode: "chromium",
    existsSync: (p) => p === chromePath,
  }), /chromium was not found/);

  const winDefault = resolveBrowserLaunch(winOptions);
  assert.equal(winDefault.kind, "default");
  assert.equal(path.win32.basename(winDefault.cmd), "powershell.exe");
  assert.match(winDefault.args.at(-1), /-FilePath \$env:KATE_MD_PREVIEW_OPEN_URL/);
  assert.ok(winDefault.args.every((argument) => !argument.includes(winOptions.url)));
  assert.equal(winDefault.env.KATE_MD_PREVIEW_OPEN_URL, winOptions.url);

  // Linux: falls back to Firefox chromeless profile when Chromium is absent
  const linuxFf = resolveBrowserLaunch({
    url,
    appUrl,
    appMode: "auto",
    platform: "linux",
    existsSync: (p) => p === "/usr/bin/firefox",
    findInPath: () => null,
    prepareFirefoxProfile: () => "/tmp/ff-profile",
  });
  assert.equal(linuxFf.kind, "firefox");
  assert.equal(linuxFf.cmd, "/usr/bin/firefox");
  assert.deepEqual(linuxFf.args, ["--no-remote", "--profile", "/tmp/ff-profile", "--name", "kate-md-preview", url]);

  // macOS: falls back to Safari dedicated window via osascript when Chromium & Firefox absent
  const macSafari = resolveBrowserLaunch({
    url,
    appUrl,
    appMode: "auto",
    platform: "darwin",
    existsSync: () => false,
    findInPath: () => null,
  });
  assert.equal(macSafari.kind, "safari");
  assert.equal(macSafari.cmd, "osascript");
  assert.equal(macSafari.args[0], "-e");
  assert.equal(macSafari.args[2], url);

  // Firefox profile creation + live lock overflow handling + stale overflow pruning
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-ff-"));
  try {
    const linuxProfileOptions = { platform: "linux", cacheRoot: tmpCache };
    const staleOverflow = path.join(tmpCache, "firefox-app-profile-999999-1");
    fs.mkdirSync(staleOverflow, { recursive: true });

    const p1 = ensureFirefoxAppProfile(linuxProfileOptions);
    assert.equal(p1, path.join(tmpCache, "firefox-app-profile"));
    assert.ok(!fs.existsSync(staleOverflow), "stale unlocked overflow profile should be pruned");
    assert.match(fs.readFileSync(path.join(p1, "user.js"), "utf8"), /legacyUserProfileCustomizations/);
    assert.match(fs.readFileSync(path.join(p1, "chrome", "userChrome.css"), "utf8"), /#TabsToolbar/);

    // Windows hosts can exercise the Linux fallback without symlink privileges.
    const lockPath = path.join(p1, "lock");
    if (process.platform === "win32") {
      fs.writeFileSync(lockPath, "");
    } else {
      fs.symlinkSync(`127.0.1.1:+${process.pid}`, lockPath);
    }
    const p2 = ensureFirefoxAppProfile(linuxProfileOptions);
    assert.notEqual(p2, p1);
    assert.ok(fs.existsSync(path.join(p2, "chrome", "userChrome.css")));

    fs.unlinkSync(lockPath);
    fs.writeFileSync(path.join(p1, ".parentlock"), "");
    const macFirefoxPath = "/Applications/Firefox.app/Contents/MacOS/firefox";
    const macFirefox = resolveBrowserLaunch({
      url,
      appMode: "auto",
      platform: "darwin",
      existsSync: (p) => p === macFirefoxPath,
      prepareFirefoxProfile: () => ensureFirefoxAppProfile({ platform: "darwin", cacheRoot: tmpCache }),
    });
    assert.deepEqual(macFirefox, {
      kind: "firefox",
      cmd: macFirefoxPath,
      args: ["--profile", p1, "--new-window", url],
    });

    // Windows Firefox leaves parent.lock behind after releasing the actual lock.
    fs.writeFileSync(path.join(p1, "parent.lock"), "");
    const winFirefoxPath = path.win32.join(programFiles, "Mozilla Firefox\\firefox.exe");
    const winFirefox = resolveBrowserLaunch({
      ...winOptions,
      appMode: "firefox",
      existsSync: (p) => p === winFirefoxPath,
      prepareFirefoxProfile: () => ensureFirefoxAppProfile({ platform: "win32", cacheRoot: tmpCache }),
    });
    assert.deepEqual(winFirefox, {
      kind: "firefox",
      cmd: winFirefoxPath,
      args: ["--profile", p1, "--new-window", winOptions.url],
    });
  } finally {
    fs.rmSync(tmpCache, { recursive: true, force: true });
  }
});

test("Linux context menu installer and uninstaller are idempotent with proper permissions", () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-menu-"));
  const applicationsDir = path.join(tmpData, "applications");
  const serviceMenusDir = path.join(tmpData, "kio", "servicemenus");
  const unrelatedDesktop = path.join(applicationsDir, "unrelated.desktop");

  try {
    fs.mkdirSync(applicationsDir, { recursive: true });
    fs.writeFileSync(unrelatedDesktop, "[Desktop Entry]\nName=Unrelated\n");

    const first = installLinuxMenu({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      applicationsDir,
      serviceMenusDir,
      refreshCaches: false,
    });
    assert.equal(first.length, 2);
    assert.ok(first.every((item) => item.status === "installed"));

    const openWithText = fs.readFileSync(first[0].filePath, "utf8");
    assert.match(openWithText, /^MimeType=text\/markdown;$/m);
    assert.match(openWithText, /^NoDisplay=true$/m);
    assert.match(openWithText, /--app %f$/m);

    const dolphinText = fs.readFileSync(first[1].filePath, "utf8");
    assert.match(dolphinText, /^Type=Service$/m);
    assert.match(dolphinText, /^MimeType=text\/markdown;$/m);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(first[0].filePath).mode & 0o777, 0o644);
      assert.equal(fs.statSync(first[1].filePath).mode & 0o777, 0o755);
    }

    // 2nd run: idempotent
    const second = installLinuxMenu({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      applicationsDir,
      serviceMenusDir,
      refreshCaches: false,
    });
    assert.ok(second.every((item) => item.status === "unchanged"));

    // Switching to --browser updates cleanly
    const third = installLinuxMenu({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      applicationsDir,
      serviceMenusDir,
      useBrowser: true,
      refreshCaches: false,
    });
    assert.ok(third.every((item) => item.status === "updated"));
    assert.match(fs.readFileSync(third[0].filePath, "utf8"), /--browser %f$/m);

    if (process.platform === "linux") {
      const env = { ...process.env, XDG_DATA_HOME: tmpData };
      const cliInstall1 = execFileSync(process.execPath, [CLI_PATH, "install-menu"], {
        env,
        encoding: "utf8",
      });
      assert.match(cliInstall1, /Updated:|Installed:/);
      const cliInstall2 = execFileSync(process.execPath, [CLI_PATH, "install-menu"], {
        env,
        encoding: "utf8",
      });
      assert.match(cliInstall2, /already up to date/);

      const cliUninstall1 = execFileSync(process.execPath, [CLI_PATH, "uninstall-menu"], {
        env,
        encoding: "utf8",
      });
      assert.match(cliUninstall1, /Removed:/);
      const cliUninstall2 = execFileSync(process.execPath, [CLI_PATH, "uninstall-menu"], {
        env,
        encoding: "utf8",
      });
      assert.match(cliUninstall2, /Already uninstalled/);
    }

    assert.ok(fs.existsSync(unrelatedDesktop), "unrelated desktop file must remain intact");
  } finally {
    fs.rmSync(tmpData, { recursive: true, force: true });
  }
});

test("Windows context menu installs a launcher and icons and upgrades older entries", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-winmenu-"));
  const registry = new Map();
  const registryIcons = new Map();
  let failedWriteKey;
  let failDelete = false;

  const mockReg = (cmd, args) => {
    assert.equal(cmd, "reg");
    const op = args[0];
    const key = args[1];
    const isIconValue = args[2] === "/v" && args[3] === "Icon";
    const values = isIconValue ? registryIcons : registry;
    if (op === "query") {
      if (values.has(key)) {
        const name = isIconValue ? "Icon" : "(Default)";
        return { status: 0, stdout: `    ${name}    REG_SZ    ${values.get(key)}\r\n`, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key" };
    }
    if (op === "add") {
      if (key === failedWriteKey) return { status: 1, stderr: "Access denied" };
      const valIdx = args.indexOf("/d");
      values.set(key, valIdx !== -1 ? args[valIdx + 1] : "");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (op === "delete") {
      if (failDelete) return { status: 1, stderr: "Access denied" };
      registryIcons.delete(key);
      for (const k of Array.from(registry.keys())) {
        if (k === key || k.startsWith(`${key}\\`)) registry.delete(k);
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected reg op: ${op}`);
  };

  const nodePath = "C:\\Users\\张三\\Node JS\\node.exe";
  const cliPath = "C:\\Users\\张三\\npm\\Markdown 📘\\bin\\cli.mjs";
  const documentPath = "C:\\Users\\张三\\%TEMP%\\我的文档.md";
  const options = { cliPath, nodePath, menuDir: tmpDir, runCommand: mockReg, cscPath: null };
  try {
    const first = installWindowsMenu(options);
    assert.equal(first.length, 4);
    assert.ok(first.every((item) => item.status === "installed"));

    const launcherPath = path.join(tmpDir, "launch.js");
    const legacyPath = path.join(tmpDir, "launch.vbs");
    const iconPath = path.join(tmpDir, "kate-md-preview.ico");
    const icon = fs.readFileSync(iconPath);
    assert.equal(icon.readUInt16LE(2), 1);
    const iconSizes = Array.from({ length: icon.readUInt16LE(4) }, (_, i) => icon[6 + i * 16] || 256);
    assert.ok(iconSizes.includes(16) && iconSizes.includes(32));
    const keys = getWindowsRegistryKeys();
    for (const { shellKey } of keys) {
      assert.equal(registryIcons.get(shellKey), `"${iconPath}",0`);
    }
    const launcher = fs.readFileSync(launcherPath, "utf8");
    assert.doesNotMatch(launcher, /[^\x00-\x7f]/);
    const calls = [];
    runInNewContext(launcher, {
      WScript: { Arguments: { length: 1, Item: () => documentPath } },
      ActiveXObject: function (name) {
        assert.equal(name, "Shell.Application");
        this.ShellExecute = (...args) => calls.push(args);
      },
    });
    assert.deepEqual(calls, [[nodePath, `"${cliPath}" --app "${documentPath}"`, "", "open", 0]]);

    // 2nd run: idempotent
    const second = installWindowsMenu(options);
    assert.ok(second.every((item) => item.status === "unchanged"));

    // Existing JScript installations have valid commands but no icon registration.
    registryIcons.clear();
    fs.unlinkSync(iconPath);
    failedWriteKey = keys[0].commandKey;
    const withIcons = installWindowsMenu(options);
    assert.equal(withIcons[0].status, "unchanged");
    assert.deepEqual(withIcons.slice(2).map((item) => item.status), ["updated", "updated"]);
    assert.deepEqual(fs.readFileSync(iconPath), icon);
    assert.equal(registryIcons.size, 2);

    fs.writeFileSync(legacyPath, "legacy launcher");
    for (const { commandKey } of keys) {
      registry.set(commandKey, `wscript.exe "${legacyPath}" "%1"`);
    }
    failedWriteKey = keys[1].commandKey;
    assert.throws(() => installWindowsMenu({ ...options, useBrowser: true }), /Access denied/);
    assert.ok(fs.existsSync(legacyPath));
    assert.match(registry.get(keys[0].commandKey), /\/\/E:JScript.+launch\.js/);
    assert.match(registry.get(keys[1].commandKey), /launch\.vbs/);
    failedWriteKey = undefined;
    installWindowsMenu({ ...options, useBrowser: true });
    assert.match(fs.readFileSync(launcherPath, "utf8"), /--browser/);
    assert.ok(!fs.existsSync(legacyPath));

    failDelete = true;
    assert.throws(() => uninstallWindowsMenu(options), /Access denied/);
    assert.ok(fs.existsSync(launcherPath));
    assert.ok(fs.existsSync(iconPath));
    failDelete = false;
    const removed1 = uninstallWindowsMenu({ menuDir: tmpDir, runCommand: mockReg });
    assert.equal(removed1.length, 4);
    assert.ok(!fs.existsSync(launcherPath));
    assert.ok(!fs.existsSync(iconPath));
    assert.equal(registryIcons.size, 0);
    assert.equal(registry.size, 0);

    const removed2 = uninstallWindowsMenu({ menuDir: tmpDir, runCommand: mockReg });
    assert.equal(removed2.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Windows context menu compiles native exe via csc.exe for Open With and falls back cleanly on failure", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-winexe-"));
  // regStore: Map<key, Map<valueName, value>>  (valueName "" represents (Default))
  const regStore = new Map();
  let cscCalls = 0;
  let failCsc = false;
  const fakeCsc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

  const setReg = (key, name, val) => {
    if (!regStore.has(key)) regStore.set(key, new Map());
    regStore.get(key).set(name, val);
  };

  const mockCmd = (cmd, args) => {
    if (cmd === fakeCsc) {
      cscCalls++;
      if (failCsc) return { status: 1, stdout: "", stderr: "csc blocked by policy" };
      assert.ok(args.includes("/target:winexe"));
      const outArg = args.find((a) => a.startsWith("/out:"));
      const iconArg = args.find((a) => a.startsWith("/win32icon:"));
      const csFile = args.at(-1);
      assert.ok(outArg && iconArg && csFile);
      assert.ok(fs.existsSync(iconArg.slice("/win32icon:".length)));
      const csSource = fs.readFileSync(csFile, "utf8");
      assert.doesNotMatch(csSource, /[^\x00-\x7f]/);
      assert.match(csSource, /AssemblyTitle\("Markdown Preview"\)/);
      assert.match(csSource, /CreateNoWindow = true/);
      fs.writeFileSync(outArg.slice("/out:".length), Buffer.from("MZ-FAKE-WINEXE"));
      return { status: 0, stdout: "", stderr: "" };
    }

    assert.equal(cmd, "reg");
    const op = args[0];
    const key = args[1];
    const vIdx = args.indexOf("/v");
    const valueName = vIdx !== -1 ? args[vIdx + 1] : args.includes("/ve") ? "" : null;

    if (op === "query") {
      const bucket = regStore.get(key);
      if (!bucket) return { status: 1, stdout: "", stderr: "not found" };
      if (valueName === null) return { status: 0, stdout: key, stderr: "" };
      if (!bucket.has(valueName)) return { status: 1, stdout: "", stderr: "value not found" };
      const label = valueName === "" ? "(Default)" : valueName;
      return { status: 0, stdout: `    ${label}    REG_SZ    ${bucket.get(valueName)}\r\n`, stderr: "" };
    }

    if (op === "add") {
      const dIdx = args.indexOf("/d");
      setReg(key, valueName ?? "", dIdx !== -1 ? args[dIdx + 1] : "");
      return { status: 0, stdout: "", stderr: "" };
    }

    if (op === "delete") {
      if (valueName !== null) {
        const bucket = regStore.get(key);
        if (bucket) bucket.delete(valueName);
      } else {
        for (const k of Array.from(regStore.keys())) {
          if (k === key || k.startsWith(`${key}\\`)) regStore.delete(k);
        }
      }
      return { status: 0, stdout: "", stderr: "" };
    }

    throw new Error(`Unexpected command: ${cmd} ${args.join(" ")}`);
  };

  const nodePath = "C:\\Users\\张三\\nodejs\\node.exe";
  const cliPath = "C:\\Users\\张三\\npm\\cli.mjs";
  const ow = getWindowsOpenWithKeys();

  try {
    // Seed an unrelated app in .md\OpenWithProgids to verify we never clobber it
    setReg(ow.openWithProgidsKeys[0].key, "OtherApp.Markdown", "");
    // Seed an old JScript launcher to verify upgrade cleans it up
    const oldJscriptPath = path.join(tmpDir, "launch.js");
    fs.writeFileSync(oldJscriptPath, "// old jscript");

    const csSample = buildWindowsLauncherCSharp({ nodePath, cliPath, useBrowser: false });
    assert.doesNotMatch(csSample, /[^\x00-\x7f]/);

    // 1st install: compiles native exe and registers both shell menu and Open With
    const first = installWindowsMenu({
      cliPath,
      nodePath,
      menuDir: tmpDir,
      runCommand: mockCmd,
      cscPath: fakeCsc,
    });
    assert.equal(cscCalls, 1);
    assert.ok(first.some((r) => r.name === "Windows Native Launcher" && r.status === "installed"));
    assert.ok(first.some((r) => r.name === "Windows Open With" && r.status === "installed"));
    const exePath = path.join(tmpDir, "kate-md-preview.exe");
    assert.ok(fs.existsSync(exePath));
    assert.ok(!fs.existsSync(oldJscriptPath), "stale launch.js should be removed after exe install");
    assert.equal(regStore.get(ow.progIdCommandKey)?.get(""), `"${exePath}" "%1"`);
    assert.equal(regStore.get(ow.progIdAppKey)?.get("ApplicationName"), "Markdown Preview");
    assert.equal(regStore.get(ow.progIdAppKey)?.get("ApplicationIcon"), `"${exePath}",0`);
    assert.equal(regStore.get(ow.appKey)?.get("ApplicationIcon"), `"${exePath}",0`);
    assert.equal(regStore.get(ow.appIconKey)?.get(""), `"${exePath}",0`);
    assert.equal(regStore.get(ow.appCommandKey)?.get(""), `"${exePath}" "%1"`);
    assert.ok(regStore.get(ow.openWithProgidsKeys[0].key)?.has(ow.progId));
    assert.ok(regStore.get(ow.openWithProgidsKeys[0].key)?.has("OtherApp.Markdown"));

    // 2nd install: fully idempotent (does not recompile)
    const second = installWindowsMenu({
      cliPath,
      nodePath,
      menuDir: tmpDir,
      runCommand: mockCmd,
      cscPath: fakeCsc,
    });
    assert.equal(cscCalls, 1);
    assert.ok(second.every((r) => r.status === "unchanged"));

    // Changing --browser recompiles cleanly
    const third = installWindowsMenu({
      cliPath,
      nodePath,
      menuDir: tmpDir,
      useBrowser: true,
      runCommand: mockCmd,
      cscPath: fakeCsc,
    });
    assert.equal(cscCalls, 2);
    assert.equal(third[0].status, "updated");

    // Automatic fallback when csc.exe fails: writes launch.js and cleans up stale exe + Open With
    failCsc = true;
    const fallback = installWindowsMenu({
      cliPath,
      nodePath,
      menuDir: tmpDir,
      useBrowser: false,
      runCommand: mockCmd,
      cscPath: fakeCsc,
    });
    assert.ok(fallback.some((r) => r.name === "Windows Silent Launcher"));
    assert.ok(!fallback.some((r) => r.name === "Windows Open With"));
    assert.ok(fs.existsSync(path.join(tmpDir, "launch.js")));
    assert.ok(!fs.existsSync(exePath));
    assert.ok(!regStore.has(ow.progIdKey));
    assert.ok(!regStore.get(ow.openWithProgidsKeys[0].key)?.has(ow.progId));
    assert.ok(regStore.get(ow.openWithProgidsKeys[0].key)?.has("OtherApp.Markdown"));

    // Re-enable csc.exe, install again, then verify uninstall preserves OtherApp.Markdown
    failCsc = false;
    installWindowsMenu({
      cliPath,
      nodePath,
      menuDir: tmpDir,
      runCommand: mockCmd,
      cscPath: fakeCsc,
    });
    const removed1 = uninstallWindowsMenu({ menuDir: tmpDir, runCommand: mockCmd });
    assert.ok(removed1.length > 0);
    assert.ok(!fs.existsSync(exePath));
    assert.ok(!fs.existsSync(path.join(tmpDir, "launcher.json")));
    assert.ok(!regStore.has(ow.progIdKey));
    assert.ok(!regStore.has(ow.appKey));
    assert.ok(!regStore.get(ow.openWithProgidsKeys[0].key)?.has(ow.progId));
    assert.ok(
      regStore.get(ow.openWithProgidsKeys[0].key)?.has("OtherApp.Markdown"),
      "unrelated OpenWithProgids entry must remain intact"
    );

    const removed2 = uninstallWindowsMenu({ menuDir: tmpDir, runCommand: mockCmd });
    assert.equal(removed2.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("macOS Finder Open With installer builds .app bundle with Markdown plist idempotently", () => {
  const tmpApps = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-macmenu-"));
  const plistValues = new Map();
  let compileCount = 0;
  const cliPath = path.join(tmpApps, 'Path with apostrophe\'s and "quotes"', "cli.mjs");
  const nodePath = process.execPath;

  const runCommand = (cmd, args) => {
    if (cmd === "osacompile") {
      compileCount++;
      assert.deepEqual(args.slice(0, 3), ["-l", "JavaScript", "-o"]);
      const script = fs.readFileSync(args[4], "utf8");
      assert.match(script, /function openDocuments\(documents\)/);
      assert.ok(script.includes(JSON.stringify(cliPath)));
    }
    if (cmd === "plutil" && args[0] === "-replace") plistValues.set(args[1], args[3]);
    if (cmd === "codesign") {
      assert.ok(fs.existsSync(path.join(args.at(-1), "Contents", "Resources", "kate-md-preview.json")));
    }
    if (process.platform === "darwin" && !cmd.endsWith("lsregister")) {
      return spawnSync(cmd, args, { encoding: "utf8" });
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const options = { cliPath, nodePath, applicationsDir: tmpApps, runCommand };

  try {
    const first = installMacMenu(options);
    assert.equal(first.length, 1);
    assert.equal(first[0].status, "installed");
    assert.equal(compileCount, 1);

    const appPath = first[0].filePath;
    assert.equal(plistValues.get("CFBundleIconFile"), "kate-md-preview.icns");
    assert.equal(plistValues.get("LSUIElement"), "YES");
    const [documentType] = JSON.parse(plistValues.get("CFBundleDocumentTypes"));
    assert.equal(documentType.LSHandlerRank, "Alternate");
    assert.deepEqual(documentType.LSItemContentTypes, ["net.daringfireball.markdown"]);
    const [importedType] = JSON.parse(plistValues.get("UTImportedTypeDeclarations"));
    assert.deepEqual(importedType.UTTypeTagSpecification["public.filename-extension"], ["md", "markdown", "mdown", "mkd"]);

    const second = installMacMenu(options);
    assert.equal(second[0].status, "unchanged");
    assert.equal(compileCount, 1);

    // Launcher version 3 generated an icon with a single 256 x 256 representation.
    const markerPath = path.join(appPath, "Contents", "Resources", "kate-md-preview.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    fs.writeFileSync(markerPath, JSON.stringify({ ...marker, launcherVersion: 3 }));
    const updated = installMacMenu(options);
    assert.equal(updated[0].status, "updated");
    assert.equal(compileCount, 2);

    const icon = fs.readFileSync(path.join(path.dirname(markerPath), "kate-md-preview.icns"));
    assert.equal(icon.toString("ascii", 0, 4), "icns");
    assert.equal(icon.readUInt32BE(4), icon.length);
    const sizes = new Map();
    for (let offset = 8; offset < icon.length;) {
      const type = icon.toString("ascii", offset, offset + 4);
      const chunkSize = icon.readUInt32BE(offset + 4);
      assert.ok(chunkSize >= 8 && offset + chunkSize <= icon.length);
      if (icon.toString("ascii", offset + 9, offset + 12) === "PNG") {
        sizes.set(type, icon.readUInt32BE(offset + 24));
      }
      offset += chunkSize;
    }
    assert.equal(sizes.get("icp4"), 16);
    assert.equal(sizes.get("ic11"), 32);
    assert.equal(sizes.get("ic12"), 64);
    if (process.platform === "darwin") {
      const plistPath = path.join(appPath, "Contents", "Info.plist");
      const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], { encoding: "utf8" }));
      assert.equal(plist.CFBundleIconFile, "kate-md-preview.icns");
      assert.equal(plist.CFBundleIconName, undefined);
      execFileSync("codesign", ["--verify", "--strict", appPath]);
    }

    const removed1 = uninstallMacMenu(options);
    assert.equal(removed1.length, 1);
    assert.ok(!fs.existsSync(appPath));

    const removed2 = uninstallMacMenu(options);
    assert.equal(removed2.length, 0);
  } finally {
    fs.rmSync(tmpApps, { recursive: true, force: true });
  }
});

test("terminal formatter applies ANSI colors and cross-platform Unicode/ASCII glyphs cleanly", () => {
  assert.equal(supportsColor({ stream: { isTTY: true }, env: {} }), true);
  assert.equal(supportsColor({ stream: { isTTY: false }, env: {} }), false);
  assert.equal(supportsColor({ stream: { isTTY: true }, env: { NO_COLOR: "1" } }), false);
  assert.equal(supportsColor({ stream: { isTTY: false }, env: { FORCE_COLOR: "1" } }), true);
  assert.equal(supportsColor({ stream: { isTTY: true }, env: { TERM: "dumb" } }), false);
  assert.equal(supportsColor({ stream: { isTTY: true, hasColors: () => false }, env: {} }), false);

  // Cross-platform Unicode detection
  assert.equal(supportsUnicode({ platform: "linux", env: { LANG: "en_US.UTF-8" } }), true);
  assert.equal(supportsUnicode({ platform: "darwin", env: {} }), true);
  assert.equal(supportsUnicode({ platform: "linux", env: { LC_ALL: "C" } }), false);
  assert.equal(supportsUnicode({ platform: "win32", env: {} }), false);
  assert.equal(supportsUnicode({ platform: "win32", env: { WT_SESSION: "abc" } }), true);
  assert.equal(supportsUnicode({ platform: "win32", env: { TERM_PROGRAM: "vscode" } }), true);

  const plainUnicode = createFormatter({ color: false, unicode: true });
  assert.equal(plainUnicode.ok("Done"), "✓ Done");
  assert.doesNotMatch(plainUnicode.url("http://127.0.0.1:3000"), /\x1b\[/);

  const asciiFallback = createFormatter({ color: false, unicode: false });
  assert.equal(asciiFallback.ok("Done"), "+ Done");
  assert.equal(asciiFallback.err("Boom"), "x Boom");
  assert.equal(asciiFallback.glyphs.arrow, "->");
  assert.doesNotMatch(
    [
      asciiFallback.brand("app"),
      asciiFallback.ok("ok"),
      asciiFallback.update("up"),
      asciiFallback.warn("w"),
      asciiFallback.err("e"),
      asciiFallback.note("n"),
    ].join(" "),
    /[^\x00-\x7f]/
  );

  const styled = createFormatter({ color: true, unicode: true });
  assert.match(styled.ok("Done"), /\x1b\[32m✓\x1b\[0m Done/);
  assert.match(styled.err("Boom"), /\x1b\[31m✗\x1b\[0m Boom/);
  assert.match(styled.url("http://127.0.0.1:3000"), /\x1b\[36m\x1b\[4mhttp:\/\/127\.0\.0\.1:3000\x1b\[0m/);

  const uniBanner = plainUnicode.banner({ version: "1.4.0", subtitle: "foreground preview", active: true });
  assert.equal(uniBanner.split("\n").length, 3);
  assert.match(uniBanner, /█▄ ▄█/);
  assert.match(uniBanner, /\(●\)/);

  const asciiActive = asciiFallback.banner({ version: "1.4.0", subtitle: "daemon status", active: true });
  assert.equal(asciiActive.split("\n").length, 3);
  assert.doesNotMatch(asciiActive, /[^\x00-\x7f]/);
  assert.match(asciiActive, /\(o\)/);

  const asciiIdle = asciiFallback.banner({ version: "1.4.0", subtitle: "daemon status", active: false });
  assert.equal(asciiIdle.split("\n").length, 3);
  assert.doesNotMatch(asciiIdle, /[^\x00-\x7f]/);
  assert.match(asciiIdle, /<  ---  >/);
});
