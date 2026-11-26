import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./renderer.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "assets");

export function getStateFilePath() {
  return path.join(
    process.env.XDG_RUNTIME_DIR || os.tmpdir(),
    "kate-md-preview.json"
  );
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
};

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdown", ".mkd", ".mdx"]);

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTS.has(path.extname(filePath).toLowerCase());
}

function findSessionRoot(absFile) {
  const dir = path.dirname(absFile);
  let cur = dir;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dir;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contentHash(str) {
  return crypto.createHash("sha1").update(str).digest("hex");
}

function resolveAssets() {
  const katexCss = require.resolve("katex/dist/katex.min.css");
  const katexFontsDir = path.join(path.dirname(katexCss), "fonts");
  const assetMap = new Map([
    [
      "/assets/github-markdown-light.css",
      require.resolve("github-markdown-css/github-markdown-light.css"),
    ],
    [
      "/assets/github-markdown-dark.css",
      require.resolve("github-markdown-css/github-markdown-dark.css"),
    ],
    [
      "/assets/hljs-light.css",
      require.resolve("highlight.js/styles/github.min.css"),
    ],
    [
      "/assets/hljs-dark.css",
      require.resolve("highlight.js/styles/github-dark.min.css"),
    ],
    ["/assets/katex/katex.min.css", katexCss],
    ["/assets/icon.svg", path.join(ASSETS_DIR, "icon.svg")],
    ["/assets/icon-256.png", path.join(ASSETS_DIR, "icon-256.png")],
    ["/favicon.ico", path.join(ASSETS_DIR, "icon-256.png")],
  ]);
  return { assetMap, katexFontsDir };
}

const WEB_MANIFEST = JSON.stringify({
  name: "Markdown Preview",
  short_name: "MD Preview",
  display: "standalone",
  icons: [
    { src: "/assets/icon-256.png", sizes: "256x256", type: "image/png" },
    { src: "/assets/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
});

function buildPageHtml({ title, relPath, sessionId, encodedRelPath, renderedHtml }) {
  const fragmentUrl = `/api/fragment?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(encodedRelPath)}`;
  const eventsUrl = `/api/events?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(encodedRelPath)}`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — Markdown Preview</title>
  <link rel="icon" type="image/png" sizes="256x256" href="/assets/icon-256.png" />
  <link rel="icon" type="image/svg+xml" href="/assets/icon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link id="gh-css-light" rel="stylesheet" href="/assets/github-markdown-light.css" media="(prefers-color-scheme: light)" />
  <link id="gh-css-dark" rel="stylesheet" href="/assets/github-markdown-dark.css" media="(prefers-color-scheme: dark)" />
  <link id="hljs-css-light" rel="stylesheet" href="/assets/hljs-light.css" media="(prefers-color-scheme: light)" />
  <link id="hljs-css-dark" rel="stylesheet" href="/assets/hljs-dark.css" media="(prefers-color-scheme: dark)" />
  <link rel="stylesheet" href="/assets/katex/katex.min.css" />
  <style>
    :root {
      --page-bg: #ffffff;
      --page-fg: #1f2328;
      --bar-bg: rgba(246, 248, 250, 0.9);
      --bar-border: #d0d7de;
      --muted-fg: #656d76;
      --alert-note: #0969da;
      --alert-tip: #1a7f37;
      --alert-important: #8250df;
      --alert-warning: #9a6700;
      --alert-caution: #cf222e;
      --pele-bg: #ffffff;
      --pele-fg: #1f2328;
      --pele-muted: #59636e;
      --pele-line: #59636e;
      --pele-surface: #f6f8fa;
      --pele-surface-alt: #ddf4ff;
      --pele-border: #d0d7de;
      --pele-accent: #0969da;
    }

    @media (prefers-color-scheme: dark) {
      :root[data-theme="auto"] {
        --page-bg: #0d1117;
        --page-fg: #e6edf3;
        --bar-bg: rgba(22, 27, 34, 0.9);
        --bar-border: #30363d;
        --muted-fg: #8b949e;
        --alert-note: #4493f8;
        --alert-tip: #3fb950;
        --alert-important: #ab7df8;
        --alert-warning: #d29922;
        --alert-caution: #f85149;
        --pele-bg: #0d1117;
        --pele-fg: #e6edf3;
        --pele-muted: #8b949e;
        --pele-line: #8b949e;
        --pele-surface: #161b22;
        --pele-surface-alt: #1f2937;
        --pele-border: #30363d;
        --pele-accent: #58a6ff;
      }
    }

    :root[data-theme="dark"] {
      --page-bg: #0d1117;
      --page-fg: #e6edf3;
      --bar-bg: rgba(22, 27, 34, 0.9);
      --bar-border: #30363d;
      --muted-fg: #8b949e;
      --alert-note: #4493f8;
      --alert-tip: #3fb950;
      --alert-important: #ab7df8;
      --alert-warning: #d29922;
      --alert-caution: #f85149;
      --pele-bg: #0d1117;
      --pele-fg: #e6edf3;
      --pele-muted: #8b949e;
      --pele-line: #8b949e;
      --pele-surface: #161b22;
      --pele-surface-alt: #1f2937;
      --pele-border: #30363d;
      --pele-accent: #58a6ff;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--page-bg);
      color: var(--page-fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 16px;
      background: var(--bar-bg);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--bar-border);
      font-size: 12px;
      color: var(--muted-fg);
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2da44e;
      flex: none;
    }

    .status-dot.disconnected { background: #d29922; }

    .filepath {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }

    .theme-btn {
      border: 1px solid var(--bar-border);
      background: transparent;
      color: var(--page-fg);
      border-radius: 6px;
      padding: 3px 9px;
      font-size: 12px;
      cursor: pointer;
    }

    .theme-btn:hover { border-color: var(--muted-fg); }

    .container {
      max-width: 1012px;
      margin: 0 auto;
      padding: 32px 32px 64px;
    }

    @media (max-width: 767px) {
      .container { padding: 16px 16px 48px; }
    }

    .markdown-body { background: transparent !important; }

    .markdown-body div[align="center"],
    .markdown-body p[align="center"] { text-align: center; }
    .markdown-body div[align="center"] > p,
    .markdown-body div[align="center"] > h1,
    .markdown-body div[align="center"] > h2,
    .markdown-body div[align="center"] > h3 { text-align: center; }
    .markdown-body div[align="center"] img {
      display: inline-block;
      vertical-align: middle;
    }

    .markdown-body pre.hljs {
      padding: 16px;
      overflow: auto;
      border-radius: 6px;
    }
    .markdown-body pre.hljs code {
      background: transparent;
      padding: 0;
    }

    .markdown-body .markdown-alert {
      padding: 0.5rem 1rem;
      margin-bottom: 16px;
      color: inherit;
      border-left: 0.25em solid var(--alert-note);
    }
    .markdown-body .markdown-alert > :first-child { margin-top: 0; }
    .markdown-body .markdown-alert > :last-child { margin-bottom: 0; }
    .markdown-body .markdown-alert .markdown-alert-title {
      display: flex;
      font-weight: 600;
      align-items: center;
      line-height: 1;
      margin-bottom: 8px;
    }
    .markdown-body .markdown-alert .markdown-alert-title svg {
      margin-right: 8px;
      fill: currentColor;
      flex: none;
    }
    .markdown-body .markdown-alert-note { border-left-color: var(--alert-note); }
    .markdown-body .markdown-alert-note .markdown-alert-title { color: var(--alert-note); }
    .markdown-body .markdown-alert-tip { border-left-color: var(--alert-tip); }
    .markdown-body .markdown-alert-tip .markdown-alert-title { color: var(--alert-tip); }
    .markdown-body .markdown-alert-important { border-left-color: var(--alert-important); }
    .markdown-body .markdown-alert-important .markdown-alert-title { color: var(--alert-important); }
    .markdown-body .markdown-alert-warning { border-left-color: var(--alert-warning); }
    .markdown-body .markdown-alert-warning .markdown-alert-title { color: var(--alert-warning); }
    .markdown-body .markdown-alert-caution { border-left-color: var(--alert-caution); }
    .markdown-body .markdown-alert-caution .markdown-alert-title { color: var(--alert-caution); }

    .markdown-body .math-block {
      margin: 16px 0;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 4px 0;
    }
    .markdown-body .katex-display { margin: 0.4em 0; }

    .markdown-body .pele-mermaid {
      margin: 16px 0;
      max-width: 100%;
      overflow-x: auto;
    }
    .markdown-body .pele-mermaid-diagram > svg {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      height: auto;
    }
    .markdown-body .pele-mermaid-error {
      color: var(--alert-caution);
      font-size: 13px;
      margin-bottom: 6px;
    }

    .markdown-body ul.contains-task-list {
      list-style: none;
      padding-left: 1.5em;
    }
    .markdown-body .task-list-item-checkbox {
      margin: 0 0.4em 0.2em -1.4em;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-left">
      <span id="status-dot" class="status-dot" title="Live reload connected"></span>
      <span class="filepath" title="${escapeHtml(relPath)}">${escapeHtml(relPath)}</span>
    </div>
    <div class="topbar-actions">
      <button id="theme-btn" class="theme-btn" type="button" title="Toggle theme">Theme: Auto</button>
    </div>
  </header>
  <main class="container">
    <article id="markdown-body" class="markdown-body">${renderedHtml}</article>
  </main>
  <script>
    (function () {
      const root = document.documentElement;
      const btn = document.getElementById("theme-btn");
      const ghLight = document.getElementById("gh-css-light");
      const ghDark = document.getElementById("gh-css-dark");
      const hljsLight = document.getElementById("hljs-css-light");
      const hljsDark = document.getElementById("hljs-css-dark");
      const modes = ["auto", "light", "dark"];
      const labels = { auto: "Theme: Auto", light: "Theme: Light", dark: "Theme: Dark" };

      function applyTheme(mode) {
        if (!modes.includes(mode)) mode = "auto";
        root.setAttribute("data-theme", mode);
        localStorage.setItem("kate-md-theme", mode);
        btn.textContent = labels[mode];
        if (mode === "light") {
          ghLight.media = "all"; hljsLight.media = "all";
          ghDark.media = "not all"; hljsDark.media = "not all";
        } else if (mode === "dark") {
          ghLight.media = "not all"; hljsLight.media = "not all";
          ghDark.media = "all"; hljsDark.media = "all";
        } else {
          ghLight.media = "(prefers-color-scheme: light)";
          hljsLight.media = "(prefers-color-scheme: light)";
          ghDark.media = "(prefers-color-scheme: dark)";
          hljsDark.media = "(prefers-color-scheme: dark)";
        }
      }

      applyTheme(localStorage.getItem("kate-md-theme") || "auto");
      btn.addEventListener("click", () => {
        const cur = root.getAttribute("data-theme") || "auto";
        const next = modes[(modes.indexOf(cur) + 1) % modes.length];
        applyTheme(next);
      });

      const dot = document.getElementById("status-dot");
      const article = document.getElementById("markdown-body");
      const es = new EventSource(${JSON.stringify(eventsUrl)});

      es.addEventListener("open", () => {
        dot.classList.remove("disconnected");
        dot.title = "Live reload connected";
      });

      es.addEventListener("error", () => {
        dot.classList.add("disconnected");
        dot.title = "Reconnecting...";
      });

      es.addEventListener("update", async () => {
        const scrollY = window.scrollY;
        const openDetails = Array.from(article.querySelectorAll("details")).map((d) => d.open);
        try {
          const resp = await fetch(${JSON.stringify(fragmentUrl)}, { cache: "no-store" });
          if (!resp.ok) return;
          const data = await resp.json();
          article.innerHTML = data.html;
          if (data.title) document.title = data.title + " — Markdown Preview";
          Array.from(article.querySelectorAll("details")).forEach((d, i) => {
            if (openDetails[i]) d.open = true;
          });
          window.scrollTo({ top: scrollY, behavior: "instant" });
        } catch {
          // ignore transient fetch errors
        }
      });
    })();
  </script>
</body>
</html>`;
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(filePath).pipe(res);
}

export function startServer({
  port = 0,
  writeState = true,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
} = {}) {
  const token = crypto.randomBytes(24).toString("hex");
  const sessionsById = new Map();
  const sessionIdByRoot = new Map();
  const watchers = new Map();
  const { assetMap, katexFontsDir } = resolveAssets();
  const stateFile = getStateFilePath();

  let lastActivity = Date.now();
  let totalClients = 0;

  function getOrCreateSession(absFile) {
    const rootDir = findSessionRoot(absFile);
    let id = sessionIdByRoot.get(rootDir);
    if (!id) {
      id = crypto.randomBytes(8).toString("hex");
      sessionIdByRoot.set(rootDir, id);
      sessionsById.set(id, { rootDir });
    }
    const relPath = path
      .relative(rootDir, absFile)
      .split(path.sep)
      .map(encodeURIComponent)
      .join("/");
    return { id, rootDir, relPath };
  }

  function resolveSessionPath(sessionId, encodedRelPath) {
    const session = sessionsById.get(sessionId);
    if (!session) return null;
    const decodedRel = encodedRelPath
      .split("/")
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .join(path.sep);
    const resolved = path.resolve(session.rootDir, decodedRel);
    const rel = path.relative(session.rootDir, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return null;
    }
    return {
      absPath: resolved,
      rootDir: session.rootDir,
      relPath: rel.split(path.sep).join("/"),
    };
  }

  function readAndRenderFile(absPath) {
    const source = fs.readFileSync(absPath, "utf8");
    const { html, title } = renderMarkdown(source);
    return {
      html,
      title: title || path.basename(absPath),
      hash: contentHash(source),
    };
  }

  function subscribeFileWatch(absPath, res) {
    let entry = watchers.get(absPath);
    if (!entry) {
      const dir = path.dirname(absPath);
      const targetName = path.basename(absPath);
      let lastHash = "";
      try {
        lastHash = contentHash(fs.readFileSync(absPath, "utf8"));
      } catch {
        // ignore
      }

      const state = {
        watcher: null,
        clients: new Set(),
        timer: null,
        lastHash,
      };

      try {
        state.watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
          if (filename && filename !== targetName && !filename.startsWith(targetName)) {
            return;
          }
          clearTimeout(state.timer);
          state.timer = setTimeout(() => {
            try {
              if (!fs.existsSync(absPath)) return;
              const text = fs.readFileSync(absPath, "utf8");
              const hash = contentHash(text);
              if (hash === state.lastHash) return;
              state.lastHash = hash;
              const payload = `event: update\ndata: ${JSON.stringify({ hash, ts: Date.now() })}\n\n`;
              for (const client of state.clients) {
                try {
                  client.write(payload);
                } catch {
                  // ignore
                }
              }
            } catch {
              // ignore transient write states
            }
          }, 70);
        });
      } catch {
        // ignore watcher failure
      }

      watchers.set(absPath, state);
      entry = state;
    }

    entry.clients.add(res);
    totalClients++;

    return () => {
      entry.clients.delete(res);
      totalClients = Math.max(0, totalClients - 1);
      if (entry.clients.size === 0) {
        clearTimeout(entry.timer);
        try {
          entry.watcher?.close();
        } catch {
          // ignore
        }
        watchers.delete(absPath);
      }
    };
  }

  const server = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          pid: process.pid,
          version: pkg.version,
          clients: totalClients,
          sessions: sessionsById.size,
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/open") {
      if (req.headers["x-preview-token"] !== token) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { file } = JSON.parse(body);
        if (!file || typeof file !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing file path" }));
          return;
        }
        let absFile = path.resolve(file);
        if (fs.existsSync(absFile) && fs.statSync(absFile).isDirectory()) {
          const readme = path.join(absFile, "README.md");
          if (fs.existsSync(readme)) absFile = readme;
        }
        if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "File not found" }));
          return;
        }
        const { id, relPath } = getOrCreateSession(absFile);
        const addr = server.address();
        const previewUrl = `http://127.0.0.1:${addr.port}/s/${id}/${relPath}`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: previewUrl }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/manifest.webmanifest") {
      res.writeHead(200, {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(WEB_MANIFEST);
      return;
    }

    if (req.method === "GET" && assetMap.has(url.pathname)) {
      serveStaticFile(res, assetMap.get(url.pathname));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/katex/fonts/")) {
      const fontName = path.basename(url.pathname);
      serveStaticFile(res, path.join(katexFontsDir, fontName));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fragment") {
      const sessionId = url.searchParams.get("session") || "";
      const fileParam = url.searchParams.get("file") || "";
      const resolved = resolveSessionPath(sessionId, fileParam);
      if (!resolved || !fs.existsSync(resolved.absPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }
      try {
        const { html, title } = readAndRenderFile(resolved.absPath);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ html, title }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const sessionId = url.searchParams.get("session") || "";
      const fileParam = url.searchParams.get("file") || "";
      const resolved = resolveSessionPath(sessionId, fileParam);
      if (!resolved || !fs.existsSync(resolved.absPath)) {
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");

      const unsubscribe = subscribeFileWatch(resolved.absPath, res);
      const keepalive = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          // ignore
        }
      }, 25_000);

      req.on("close", () => {
        clearInterval(keepalive);
        unsubscribe();
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/s/")) {
      const rest = url.pathname.slice(3);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const sessionId = rest.slice(0, slashIdx);
      const encodedRelPath = rest.slice(slashIdx + 1);
      const resolved = resolveSessionPath(sessionId, encodedRelPath);
      if (!resolved || !fs.existsSync(resolved.absPath)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("File not found");
        return;
      }

      let targetAbs = resolved.absPath;
      let targetRel = resolved.relPath;
      let targetEncodedRel = encodedRelPath;

      if (fs.statSync(targetAbs).isDirectory()) {
        const readme = path.join(targetAbs, "README.md");
        if (fs.existsSync(readme)) {
          targetAbs = readme;
          targetRel = path.join(targetRel, "README.md");
          targetEncodedRel = encodedRelPath.replace(/\/?$/, "/README.md");
        } else {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Directory listing disabled");
          return;
        }
      }

      if (isMarkdownFile(targetAbs)) {
        try {
          const { html, title } = readAndRenderFile(targetAbs);
          const page = buildPageHtml({
            title,
            relPath: targetRel,
            sessionId,
            encodedRelPath: targetEncodedRel,
            renderedHtml: html,
          });
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(page);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Render error: ${err.message}`);
        }
        return;
      }

      serveStaticFile(res, targetAbs);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  function cleanupState() {
    if (!writeState) return;
    try {
      if (fs.existsSync(stateFile)) {
        const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        if (data.pid === process.pid) fs.unlinkSync(stateFile);
      }
    } catch {
      // ignore
    }
  }

  let idleTimer = null;
  if (idleTimeoutMs > 0) {
    idleTimer = setInterval(() => {
      if (totalClients === 0 && Date.now() - lastActivity > idleTimeoutMs) {
        shutdown();
      }
    }, 60_000);
    idleTimer.unref();
  }

  function shutdown() {
    if (idleTimer) clearInterval(idleTimer);
    for (const entry of watchers.values()) {
      clearTimeout(entry.timer);
      try {
        entry.watcher?.close();
      } catch {
        // ignore
      }
    }
    watchers.clear();
    cleanupState();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (writeState) {
        fs.writeFileSync(
          stateFile,
          JSON.stringify({ pid: process.pid, port: addr.port, token }),
          { mode: 0o600 }
        );
      }
      resolve({
        server,
        port: addr.port,
        token,
        openFile(absFile) {
          const { id, relPath } = getOrCreateSession(path.resolve(absFile));
          return `http://127.0.0.1:${addr.port}/s/${id}/${relPath}`;
        },
        shutdown,
      });
    });
  });
}

// Run directly as a background daemon when executed via node src/server.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  startServer()
    .then(({ port, shutdown }) => {
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      console.log(`kate-md-preview listening on http://127.0.0.1:${port}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
