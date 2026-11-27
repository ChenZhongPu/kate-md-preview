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

test("Windows context menu installs JScript, upgrades VBScript, and retains the launcher on registry failures", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-winmenu-"));
  const registry = new Map();
  let failedWriteKey;
  let failDelete = false;

  const mockReg = (cmd, args) => {
    assert.equal(cmd, "reg");
    const op = args[0];
    const key = args[1];
    if (op === "query") {
      if (registry.has(key)) {
        return { status: 0, stdout: `    (Default)    REG_SZ    ${registry.get(key)}\r\n`, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key" };
    }
    if (op === "add") {
      if (key === failedWriteKey) return { status: 1, stderr: "Access denied" };
      const valIdx = args.indexOf("/d");
      registry.set(key, valIdx !== -1 ? args[valIdx + 1] : "");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (op === "delete") {
      if (failDelete) return { status: 1, stderr: "Access denied" };
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
  const options = { cliPath, nodePath, menuDir: tmpDir, runCommand: mockReg };
  try {
    const first = installWindowsMenu(options);
    assert.equal(first.length, 3);
    assert.ok(first.every((item) => item.status === "installed"));

    const launcherPath = path.join(tmpDir, "launch.js");
    const legacyPath = path.join(tmpDir, "launch.vbs");
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

    const keys = getWindowsRegistryKeys();
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
    failDelete = false;
    const removed1 = uninstallWindowsMenu({ menuDir: tmpDir, runCommand: mockReg });
    assert.equal(removed1.length, 3);
    assert.ok(!fs.existsSync(launcherPath));
    assert.equal(registry.size, 0);

    const removed2 = uninstallWindowsMenu({ menuDir: tmpDir, runCommand: mockReg });
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
