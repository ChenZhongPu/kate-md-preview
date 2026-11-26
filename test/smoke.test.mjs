import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../src/renderer.mjs";
import { startServer } from "../src/server.mjs";
import { installKateTools, uninstallKateTools } from "../src/kate.mjs";

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

    // 1st install: creates both .ini entries + hidden .desktop entry
    const first = installKateTools({
      cliPath: CLI_PATH,
      nodePath: "/usr/bin/node",
      toolsDir,
      applicationsDir,
    });
    assert.equal(first.length, 3);
    assert.ok(first.every((item) => item.status === "installed"));
    for (const item of first.slice(0, 2)) {
      assert.ok(fs.existsSync(item.filePath));
      const text = fs.readFileSync(item.filePath, "utf8");
      assert.match(text, /^executable=\/usr\/bin\/node$/m);
      assert.match(text, /%\{Document:FilePath\}/);
    }
    const desktopText = fs.readFileSync(first[2].filePath, "utf8");
    assert.match(first[2].filePath, /chrome-127\.0\.0\.1__kate-md-preview-Default\.desktop$/);
    assert.match(desktopText, /^StartupWMClass=chrome-127\.0\.0\.1__kate-md-preview-Default$/m);
    assert.match(desktopText, /^NoDisplay=true$/m);
    assert.match(desktopText, /icon\.svg$/m);

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
    assert.ok(!fs.existsSync(first[2].filePath), "desktop entry must be removed");
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

test("CLI starts isolated daemon, reports status, and stops cleanly", () => {
  const tmpRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-run-"));
  const tmpDocDir = fs.mkdtempSync(path.join(os.tmpdir(), "kate-md-test-cli-"));
  const mdFile = path.join(tmpDocDir, "sample.md");
  fs.writeFileSync(mdFile, "# CLI Test\n");
  const env = { ...process.env, XDG_RUNTIME_DIR: tmpRuntime };

  try {
    const urlOut = execFileSync(process.execPath, [CLI_PATH, "--no-open", mdFile], {
      env,
      encoding: "utf8",
    }).trim();
    assert.match(urlOut, /^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]+\/sample\.md$/);

    const statusOut = execFileSync(process.execPath, [CLI_PATH, "--status"], {
      env,
      encoding: "utf8",
    });
    assert.match(statusOut, /Running \(pid=\d+/);

    const stopOut = execFileSync(process.execPath, [CLI_PATH, "--stop"], {
      env,
      encoding: "utf8",
    });
    assert.match(stopOut, /Stopped kate-md-preview/);
  } finally {
    fs.rmSync(tmpRuntime, { recursive: true, force: true });
    fs.rmSync(tmpDocDir, { recursive: true, force: true });
  }
});
