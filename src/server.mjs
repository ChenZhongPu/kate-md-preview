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

function buildPageHtml({ title, relPath, sessionId, encodedRelPath, renderedHtml, port, pid }) {
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
      --chip-bg: rgba(175, 184, 193, 0.16);
      --chip-hover: rgba(175, 184, 193, 0.28);
      --thumb-shadow: 0 1px 2px rgba(31, 35, 40, 0.12);
      --drawer-bg: rgba(255, 255, 255, 0.94);
      --drawer-shadow: 0 8px 24px rgba(31, 35, 40, 0.12), 0 1px 3px rgba(31, 35, 40, 0.06);
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
        --chip-bg: rgba(110, 118, 129, 0.18);
        --chip-hover: rgba(110, 118, 129, 0.32);
        --thumb-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
        --drawer-bg: rgba(22, 27, 34, 0.94);
        --drawer-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3);
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
      --chip-bg: rgba(110, 118, 129, 0.18);
      --chip-hover: rgba(110, 118, 129, 0.32);
      --thumb-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
      --drawer-bg: rgba(22, 27, 34, 0.94);
      --drawer-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3);
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

    .server-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }

    .meta-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--muted-fg);
      opacity: 0.62;
      cursor: pointer;
      transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
    }

    .meta-toggle:hover,
    .meta-toggle[aria-expanded="true"] {
      opacity: 1;
      background: var(--chip-bg);
      color: var(--page-fg);
    }

    .meta-toggle:focus-visible {
      outline: 1.5px solid var(--alert-note);
      outline-offset: 1px;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--bar-border);
      background: var(--chip-bg);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      line-height: 1.4;
      color: var(--muted-fg);
      user-select: text;
      white-space: nowrap;
      animation: meta-fade-in 0.14s ease;
    }

    .meta-pill[hidden] {
      display: none;
    }

    .meta-pill strong {
      font-weight: 500;
      color: var(--page-fg);
    }

    .meta-sep {
      opacity: 0.45;
      user-select: none;
    }

    @keyframes meta-fade-in {
      from { opacity: 0; transform: translateX(-3px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }

    .theme-switch {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border-radius: 999px;
      border: 1px solid var(--bar-border);
      background: var(--chip-bg);
    }

    .theme-opt {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--muted-fg);
      opacity: 0.65;
      cursor: pointer;
      transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
    }

    .theme-opt:hover {
      opacity: 1;
      color: var(--page-fg);
    }

    .theme-opt[aria-checked="true"] {
      opacity: 1;
      background: var(--page-bg);
      color: var(--page-fg);
      box-shadow: var(--thumb-shadow);
    }

    .theme-opt:focus-visible,
    .outline-toggle:focus-visible,
    .width-toggle:focus-visible,
    .zoom-btn:focus-visible {
      outline: 1.5px solid var(--alert-note);
      outline-offset: 1px;
    }

    .zoom-control {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      height: 26px;
      padding: 2px;
      border-radius: 999px;
      border: 1px solid var(--bar-border);
      background: var(--chip-bg);
    }

    .zoom-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--muted-fg);
      opacity: 0.72;
      cursor: pointer;
      transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
    }

    .zoom-btn.zoom-step {
      width: 20px;
    }

    .zoom-btn.zoom-reset {
      min-width: 38px;
      padding: 0 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }

    .zoom-btn.zoom-reset.is-zoomed {
      color: var(--page-fg);
      opacity: 1;
    }

    .zoom-btn:hover:not(:disabled) {
      opacity: 1;
      color: var(--page-fg);
      background: var(--page-bg);
    }

    .zoom-btn:disabled {
      opacity: 0.28;
      cursor: default;
    }

    .outline-toggle {
      position: fixed;
      top: 84px;
      right: 10px;
      z-index: 25;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      padding: 10px 8px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      cursor: pointer;
      transition: background-color 0.16s ease, border-color 0.16s ease, opacity 0.16s ease;
    }

    .outline-toggle[hidden] {
      display: none;
    }

    .outline-toggle:hover {
      background: var(--drawer-bg);
      border-color: var(--bar-border);
      backdrop-filter: blur(8px);
      box-shadow: var(--thumb-shadow);
    }

    .outline-bar {
      display: block;
      height: 2px;
      border-radius: 999px;
      background: var(--muted-fg);
      opacity: 0.34;
      transition: opacity 0.16s ease, background-color 0.16s ease, width 0.16s ease;
    }

    .outline-bar.d0 { width: 16px; }
    .outline-bar.d1 { width: 12px; }
    .outline-bar.d2 { width: 8px; }

    .outline-toggle:hover .outline-bar {
      opacity: 0.65;
    }

    .outline-bar.active,
    .outline-toggle:hover .outline-bar.active {
      opacity: 1;
      background: var(--page-fg);
    }

    .outline-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--muted-fg);
      opacity: 0.65;
      cursor: pointer;
      transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
    }

    .outline-close:hover {
      opacity: 1;
      color: var(--page-fg);
      background: var(--chip-bg);
    }

    .outline-close:focus-visible {
      outline: 1.5px solid var(--alert-note);
      outline-offset: 1px;
    }

    .outline-header-left {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .width-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 26px;
      padding: 0;
      border-radius: 999px;
      border: 1px solid var(--bar-border);
      background: var(--chip-bg);
      color: var(--muted-fg);
      opacity: 0.78;
      cursor: pointer;
      transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
    }

    .width-toggle:hover {
      opacity: 1;
      color: var(--page-fg);
    }

    .width-toggle[aria-pressed="true"] {
      opacity: 1;
      background: var(--page-bg);
      color: var(--page-fg);
      box-shadow: var(--thumb-shadow);
    }

    .page-layout {
      position: relative;
    }

    .container {
      max-width: 1012px;
      margin: 0 auto;
      padding: 32px 44px 64px 32px;
    }

    :root[data-width="wide"] .container {
      max-width: none;
      width: 100%;
      padding: 32px 52px 64px 44px;
    }

    @media (max-width: 767px) {
      .container,
      :root[data-width="wide"] .container { padding: 16px 36px 48px 16px; }
    }

    .outline-panel[hidden] {
      display: none;
    }

    .outline-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 2px 8px 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted-fg);
    }

    .outline-count {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--chip-bg);
      color: var(--muted-fg);
    }

    .outline-nav {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .outline-link {
      display: block;
      padding: 4px 8px 4px calc(10px + var(--depth, 0) * 12px);
      border-left: 2px solid transparent;
      border-radius: 0 5px 5px 0;
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--muted-fg);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease;
    }

    .outline-link:hover {
      color: var(--page-fg);
      background: var(--chip-bg);
    }

    .outline-link.active {
      color: var(--page-fg);
      font-weight: 500;
      border-left-color: var(--alert-note);
      background: var(--chip-bg);
    }

    .outline-empty {
      padding: 8px;
      font-size: 12px;
      color: var(--muted-fg);
      opacity: 0.75;
    }

    @media (min-width: 1280px) {
      .page-layout.outline-open {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        gap: 24px;
        max-width: 1320px;
        margin: 0 auto;
        padding-right: 24px;
      }

      :root[data-width="wide"] .page-layout.outline-open {
        max-width: none;
        width: 100%;
        padding-right: 32px;
      }

      .page-layout.outline-open .container {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
      }

      .page-layout.outline-open .outline-panel {
        position: sticky;
        top: 52px;
        width: 248px;
        flex: none;
        max-height: calc(100vh - 68px);
        overflow-y: auto;
        margin-top: 28px;
        padding: 2px 0 16px 12px;
        border-left: 1px solid var(--bar-border);
      }
    }

    @media (max-width: 1279px) {
      .outline-panel {
        position: fixed;
        top: 44px;
        right: 14px;
        z-index: 30;
        width: min(272px, calc(100vw - 28px));
        max-height: calc(100vh - 64px);
        overflow-y: auto;
        padding: 10px 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--bar-border);
        background: var(--drawer-bg);
        backdrop-filter: blur(12px);
        box-shadow: var(--drawer-shadow);
        animation: outline-pop 0.14s ease;
      }
    }

    @keyframes outline-pop {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .markdown-body [id] {
      scroll-margin-top: 52px;
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
      <span class="server-meta">
        <button id="meta-toggle" class="meta-toggle" type="button" aria-expanded="false" aria-controls="server-meta-pill" title="Show server port and PID">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 7.25v3.5" />
            <circle cx="8" cy="4.85" r="0.6" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <span id="server-meta-pill" class="meta-pill" hidden>
          <span>port <strong>${escapeHtml(port)}</strong></span>
          <span class="meta-sep">·</span>
          <span>pid <strong>${escapeHtml(pid)}</strong></span>
        </span>
      </span>
    </div>
    <div class="topbar-actions">
      <div id="zoom-control" class="zoom-control" role="group" aria-label="Zoom">
        <button id="zoom-out" class="zoom-btn zoom-step" type="button" aria-label="Zoom out" title="Zoom out (Ctrl+-)">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
            <path d="M3.25 8h9.5" />
          </svg>
        </button>
        <button id="zoom-reset" class="zoom-btn zoom-reset" type="button" aria-label="Reset zoom" title="Reset zoom (Ctrl+0)">100%</button>
        <button id="zoom-in" class="zoom-btn zoom-step" type="button" aria-label="Zoom in" title="Zoom in (Ctrl+=)">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
            <path d="M8 3.25v9.5M3.25 8h9.5" />
          </svg>
        </button>
      </div>
      <button id="width-toggle" class="width-toggle" type="button" aria-pressed="false" aria-label="Toggle full width" title="Full width">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 4.75L1.75 8 5 11.25M11 4.75L14.25 8 11 11.25M2.25 8h11.5" />
        </svg>
      </button>
      <div id="theme-switch" class="theme-switch" role="radiogroup" aria-label="Color theme">
        <button class="theme-opt" type="button" role="radio" data-theme-opt="auto" aria-checked="true" aria-label="System theme" title="Theme: System">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="2.75" width="12" height="8.5" rx="1.5" />
            <path d="M5.5 13.75h5M8 11.25v2.5" />
          </svg>
        </button>
        <button class="theme-opt" type="button" role="radio" data-theme-opt="light" aria-checked="false" aria-label="Light theme" title="Theme: Light">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="8" cy="8" r="2.75" />
            <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06" />
          </svg>
        </button>
        <button class="theme-opt" type="button" role="radio" data-theme-opt="dark" aria-checked="false" aria-label="Dark theme" title="Theme: Dark">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.25 9.85A5.5 5.5 0 0 1 6.15 2.75a5.5 5.5 0 1 0 7.1 7.1z" />
          </svg>
        </button>
      </div>
    </div>
  </header>
  <div id="page-layout" class="page-layout">
    <main class="container">
      <article id="markdown-body" class="markdown-body">${renderedHtml}</article>
    </main>
    <button id="outline-toggle" class="outline-toggle" type="button" aria-expanded="false" aria-controls="outline-panel" aria-label="Show document outline" title="Show outline" hidden></button>
    <aside id="outline-panel" class="outline-panel" aria-label="Document outline" hidden>
      <div class="outline-header">
        <span class="outline-header-left">
          <span>Outline</span>
          <span id="outline-count" class="outline-count">0</span>
        </span>
        <button id="outline-close" class="outline-close" type="button" aria-label="Hide document outline" title="Hide outline (Esc)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <nav id="outline-nav" class="outline-nav"></nav>
    </aside>
  </div>
  <script>
    (function () {
      const root = document.documentElement;
      const themeOpts = Array.from(document.querySelectorAll(".theme-opt"));
      const ghLight = document.getElementById("gh-css-light");
      const ghDark = document.getElementById("gh-css-dark");
      const hljsLight = document.getElementById("hljs-css-light");
      const hljsDark = document.getElementById("hljs-css-dark");
      const modes = ["auto", "light", "dark"];

      function applyTheme(mode) {
        if (!modes.includes(mode)) mode = "auto";
        root.setAttribute("data-theme", mode);
        localStorage.setItem("kate-md-theme", mode);
        for (const opt of themeOpts) {
          opt.setAttribute("aria-checked", String(opt.dataset.themeOpt === mode));
        }
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
      for (const opt of themeOpts) {
        opt.addEventListener("click", () => applyTheme(opt.dataset.themeOpt));
      }

      const metaToggle = document.getElementById("meta-toggle");
      const metaPill = document.getElementById("server-meta-pill");
      if (metaToggle && metaPill) {
        metaToggle.addEventListener("click", () => {
          const expanded = metaToggle.getAttribute("aria-expanded") === "true";
          const next = !expanded;
          metaToggle.setAttribute("aria-expanded", String(next));
          metaToggle.title = next ? "Hide server port and PID" : "Show server port and PID";
          metaPill.hidden = !next;
        });
      }

      const dot = document.getElementById("status-dot");
      const article = document.getElementById("markdown-body");
      const zoomOutBtn = document.getElementById("zoom-out");
      const zoomInBtn = document.getElementById("zoom-in");
      const zoomResetBtn = document.getElementById("zoom-reset");
      const widthToggle = document.getElementById("width-toggle");

      function applyWidth(mode) {
        const isWide = mode === "wide";
        if (isWide) {
          root.setAttribute("data-width", "wide");
        } else {
          root.removeAttribute("data-width");
        }
        localStorage.setItem("kate-md-width", isWide ? "wide" : "standard");
        if (widthToggle) {
          widthToggle.setAttribute("aria-pressed", String(isWide));
          widthToggle.title = isWide ? "Standard width" : "Full width";
        }
        updateActiveHeading();
      }

      if (widthToggle) {
        widthToggle.addEventListener("click", () => {
          const isWide = root.getAttribute("data-width") === "wide";
          applyWidth(isWide ? "standard" : "wide");
        });
      }
      const ZOOM_MIN = 70;
      const ZOOM_MAX = 200;
      const ZOOM_STEP = 10;
      let zoomPercent = 100;

      function applyZoom(nextPercent) {
        const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(nextPercent / ZOOM_STEP) * ZOOM_STEP));
        zoomPercent = clamped;
        article.style.zoom = clamped === 100 ? "" : String(clamped / 100);
        localStorage.setItem("kate-md-zoom", String(clamped));
        if (zoomResetBtn) {
          zoomResetBtn.textContent = clamped + "%";
          zoomResetBtn.classList.toggle("is-zoomed", clamped !== 100);
        }
        if (zoomOutBtn) zoomOutBtn.disabled = clamped <= ZOOM_MIN;
        if (zoomInBtn) zoomInBtn.disabled = clamped >= ZOOM_MAX;
        updateActiveHeading();
      }

      if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => applyZoom(zoomPercent - ZOOM_STEP));
      if (zoomInBtn) zoomInBtn.addEventListener("click", () => applyZoom(zoomPercent + ZOOM_STEP));
      if (zoomResetBtn) zoomResetBtn.addEventListener("click", () => applyZoom(100));

      document.addEventListener("keydown", (ev) => {
        if (ev.ctrlKey || ev.metaKey) {
          if (ev.key === "=" || ev.key === "+") {
            ev.preventDefault();
            applyZoom(zoomPercent + ZOOM_STEP);
            return;
          }
          if (ev.key === "-") {
            ev.preventDefault();
            applyZoom(zoomPercent - ZOOM_STEP);
            return;
          }
          if (ev.key === "0") {
            ev.preventDefault();
            applyZoom(100);
            return;
          }
        }
      });

      window.addEventListener("wheel", (ev) => {
        if (ev.ctrlKey || ev.metaKey) {
          ev.preventDefault();
          applyZoom(zoomPercent + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
        }
      }, { passive: false });

      const pageLayout = document.getElementById("page-layout");
      const outlineToggle = document.getElementById("outline-toggle");
      const outlineClose = document.getElementById("outline-close");
      const outlinePanel = document.getElementById("outline-panel");
      const outlineNav = document.getElementById("outline-nav");
      const outlineCount = document.getElementById("outline-count");

      const MAX_RAIL_BARS = 22;
      let headingEntries = [];
      let railBars = [];
      let scrollRaf = 0;

      function syncRailVisibility() {
        if (!outlineToggle || !outlinePanel) return;
        const isOpen = !outlinePanel.hidden;
        outlineToggle.hidden = isOpen || headingEntries.length === 0;
      }

      function setOutlineOpen(open) {
        if (!outlineToggle || !outlinePanel || !pageLayout) return;
        outlineToggle.setAttribute("aria-expanded", String(open));
        outlinePanel.hidden = !open;
        pageLayout.classList.toggle("outline-open", open);
        syncRailVisibility();
        updateActiveHeading();
      }

      function rebuildOutline() {
        if (!outlineNav || !outlineCount || !outlineToggle) return;
        const headings = Array.from(article.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"));
        outlineCount.textContent = String(headings.length);
        outlineNav.innerHTML = "";
        outlineToggle.innerHTML = "";
        headingEntries = [];
        railBars = [];

        if (headings.length === 0) {
          const empty = document.createElement("div");
          empty.className = "outline-empty";
          empty.textContent = "No headings";
          outlineNav.appendChild(empty);
          syncRailVisibility();
          return;
        }

        const levels = headings.map((h) => Number(h.tagName.slice(1)));
        const minLevel = Math.min(...levels);

        headings.forEach((heading, idx) => {
          const depth = Math.min(levels[idx] - minLevel, 4);
          const text = (heading.textContent || "").trim();
          const link = document.createElement("a");
          link.className = "outline-link";
          link.href = "#" + encodeURIComponent(heading.id);
          link.textContent = text;
          link.title = text;
          link.style.setProperty("--depth", String(depth));
          link.addEventListener("click", (ev) => {
            ev.preventDefault();
            heading.scrollIntoView({ behavior: "smooth", block: "start" });
            history.replaceState(null, "", "#" + encodeURIComponent(heading.id));
            setActiveEntry(idx);
          });
          outlineNav.appendChild(link);
          headingEntries.push({ heading, link, depth });
        });

        const barCount = Math.min(headingEntries.length, MAX_RAIL_BARS);
        for (let b = 0; b < barCount; b++) {
          const srcIdx = barCount === headingEntries.length
            ? b
            : Math.round((b * (headingEntries.length - 1)) / Math.max(barCount - 1, 1));
          const barDepth = Math.min(headingEntries[srcIdx].depth, 2);
          const bar = document.createElement("span");
          bar.className = "outline-bar d" + barDepth;
          outlineToggle.appendChild(bar);
          railBars.push(bar);
        }

        syncRailVisibility();
        updateActiveHeading();
      }

      function setActiveEntry(activeIdx) {
        headingEntries.forEach((entry, i) => {
          entry.link.classList.toggle("active", i === activeIdx);
        });
        if (railBars.length > 0 && headingEntries.length > 0) {
          const activeBarIdx = railBars.length === headingEntries.length
            ? activeIdx
            : Math.round((activeIdx * (railBars.length - 1)) / Math.max(headingEntries.length - 1, 1));
          railBars.forEach((bar, i) => {
            bar.classList.toggle("active", i === activeBarIdx);
          });
        }
        const active = headingEntries[activeIdx];
        if (active && outlinePanel && !outlinePanel.hidden) {
          const pRect = outlinePanel.getBoundingClientRect();
          const lRect = active.link.getBoundingClientRect();
          if (lRect.top < pRect.top + 32 || lRect.bottom > pRect.bottom - 12) {
            active.link.scrollIntoView({ block: "nearest" });
          }
        }
      }

      function updateActiveHeading() {
        if (headingEntries.length === 0) return;
        const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
        let activeIdx = 0;
        if (nearBottom) {
          activeIdx = headingEntries.length - 1;
        } else {
          for (let i = 0; i < headingEntries.length; i++) {
            if (headingEntries[i].heading.getBoundingClientRect().top <= 76) {
              activeIdx = i;
            } else {
              break;
            }
          }
        }
        setActiveEntry(activeIdx);
      }

      if (outlineToggle) {
        outlineToggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setOutlineOpen(true);
        });
      }

      if (outlineClose) {
        outlineClose.addEventListener("click", () => setOutlineOpen(false));
      }

      document.addEventListener("click", (ev) => {
        if (
          window.innerWidth < 1280 &&
          outlinePanel &&
          !outlinePanel.hidden &&
          !outlinePanel.contains(ev.target) &&
          (!outlineToggle || !outlineToggle.contains(ev.target))
        ) {
          setOutlineOpen(false);
        }
      });

      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && outlinePanel && !outlinePanel.hidden) {
          setOutlineOpen(false);
        }
      });

      window.addEventListener("scroll", () => {
        if (scrollRaf || headingEntries.length === 0) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          updateActiveHeading();
        });
      }, { passive: true });

      rebuildOutline();

      applyWidth(localStorage.getItem("kate-md-width") || "standard");

      const savedZoom = Number(localStorage.getItem("kate-md-zoom"));
      applyZoom(Number.isFinite(savedZoom) && savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX ? savedZoom : 100);

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
          rebuildOutline();
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
        const docPath = `/s/${id}/${relPath}`;
        const previewUrl = `http://127.0.0.1:${addr.port}${docPath}`;
        const appUrl = `http://127.0.0.1:${addr.port}/kate-md-preview?target=${encodeURIComponent(docPath)}`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: previewUrl, appUrl }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/kate-md-preview") {
      const target = url.searchParams.get("target") || "";
      if (!target.startsWith("/s/") || target.startsWith("//") || /[\r\n]/.test(target)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid target");
        return;
      }
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Markdown Preview</title>
  <link rel="icon" type="image/png" sizes="256x256" href="/assets/icon-256.png" />
  <link rel="icon" type="image/svg+xml" href="/assets/icon.svg" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" />
</head>
<body>
  <script>window.location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
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
          const addr = server.address();
          const page = buildPageHtml({
            title,
            relPath: targetRel,
            sessionId,
            encodedRelPath: targetEncodedRel,
            renderedHtml: html,
            port: addr?.port ?? "",
            pid: process.pid,
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
        openAppFile(absFile) {
          const { id, relPath } = getOrCreateSession(path.resolve(absFile));
          const docPath = `/s/${id}/${relPath}`;
          return `http://127.0.0.1:${addr.port}/kate-md-preview?target=${encodeURIComponent(docPath)}`;
        },
        shutdown,
      });
    });
  });
}

// Run directly as a background daemon when executed via node src/server.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
