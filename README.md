# kate-md-preview

[![npm version](https://img.shields.io/npm/v/kate-md-preview?logo=npm&label=npm)](https://www.npmjs.com/package/kate-md-preview)

A lightweight, **editor-agnostic** local GitHub-style Markdown live previewer (`md-preview` / `kate-md-preview`)—works as a **standalone CLI / app window**, integrates directly into your **OS right-click ("Open With") menu**, and includes optional **KDE Kate** bindings.

Originally built as a non-invasive upgrade for KDE Kate's Markdown preview, the core server and CLI are completely independent of any editor.

![Side-by-side Markdown editing with kate-md-preview](example.png)

## Features

- **GitHub-accurate rendering**: Uses `markdown-it` + `github-markdown-css` + `highlight.js` with support for raw HTML layouts (`<div align="center">`, `<details>/<summary>`), remote SVG badges, task lists, tables, and GitHub-compatible heading anchors.
- **GitHub Alerts**: Supports `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, and `> [!CAUTION]`.
- **Mermaid diagrams via [`pele`](https://github.com/obsidianmd/pele)**: Renders ` ```mermaid ` blocks server-side to crisp, themeable SVG with graceful error fallback while editing.
- **Math formulas via KaTeX**: Supports inline `$...$`, display `$$...$$`, and ` ```math ` fenced blocks, with KaTeX stylesheets and fonts served locally (no CDN required).
- **Live reload without flicker**: Watches the parent directory (handling atomic editor saves) and patches the DOM over SSE while preserving scroll position and open `<details>` elements.
- **Relative links and assets**: Automatically scopes each session to the enclosing Git repository root (or parent directory), so relative images and links to sibling `.md` files work out of the box.
- **Auto / Light / Dark themes**: Follows system `prefers-color-scheme` by default and includes a compact segmented icon switcher that also updates `pele` diagram colors.
- **Notion-style document outline**: Minimal right-edge TOC bars (collapsed by default, with live scroll-spy highlight) that expand into a right-side outline rail on wide screens or a floating drawer when tiled side-by-side.
- **Standard / Full width toggle**: Defaults to GitHub's comfortable `1012px` centered reading column, with a one-click full-width toggle (Notion-style) for wide tables, code blocks, and large Mermaid diagrams.
- **Content zoom controls**: Compact zoom pill (`70%`–`200%`) in the topbar with `Ctrl+=`, `Ctrl+-`, `Ctrl+0`, and `Ctrl+Wheel` support—scales the document cleanly while keeping the topbar and outline crisp.
- **OS right-click menu & standalone CLI**: Register **Markdown Preview** in Linux, macOS, and Windows file managers via `install-menu`, launch from any terminal or editor, or optionally enable KDE Kate External Tools.

## Requirements

- Node.js `>= 20`

> [!NOTE]
> `kate-md-preview` has been tested on Linux (KDE Plasma) and macOS. Windows testing is limited. If you encounter platform-specific issues, please report them via [GitHub Issues](https://github.com/ChenZhongPu/kate-md-preview/issues).

## Installation

### From npm (recommended)

```bash
npm install -g kate-md-preview
```

Or run directly without global installation:

```bash
npx kate-md-preview README.md
```

### Upgrading

```bash
npm update -g kate-md-preview
```

The CLI automatically restarts any older background preview daemon when the package version changes. Only re-run `install-menu` (or `install-kate`) if a release updates launcher wrappers/icons or if you move your Node.js installation path.

### From source

```bash
git clone https://github.com/ChenZhongPu/kate-md-preview.git
cd kate-md-preview
npm install --omit=dev
npm link   # optional: exposes md-preview and kate-md-preview on PATH
```

## OS right-click menu integration ("Open With")

Register **Markdown Preview** in your system file manager's right-click menu for `.md` / `.markdown` files (user-level only, no `sudo` or administrator privileges required):

```bash
md-preview install-menu
# Or open in your default browser tab instead of an app window:
md-preview install-menu --browser
```

What `install-menu` sets up per platform:

- **Linux**: Installs `~/.local/share/applications/kate-md-preview-open.desktop` (`NoDisplay=true`, `MimeType=text/markdown;` — adds **Markdown Preview** under **Right-click → Open With** in Dolphin, GNOME Files, Thunar, etc.) and `~/.local/share/kio/servicemenus/kate-md-preview.desktop` (`0755` — adds a KDE Dolphin right-click service menu action), without changing your default editor.
- **macOS**: Uses macOS built-in `osacompile` to generate a lightweight `~/Applications/Markdown Preview.app` wrapper (with multi-resolution Retina `.icns` icon) declaring Markdown document types (`net.daringfireball.markdown`, `.md`, `.markdown`), making **Markdown Preview** available in Finder's **Right-click → Open With** menu.
- **Windows**: Compiles a tiny native windowless launcher (`%LOCALAPPDATA%\kate-md-preview\kate-md-preview.exe`, with embedded multi-resolution `.ico` icon) using the built-in .NET Framework `csc.exe`, registering both **Right-click → Open with → Markdown Preview** (visible directly in the top-level menu on Windows 11 via `HKCU\Software\Classes\...\OpenWithProgids`) and Explorer's `.md` / `.markdown` shell menu. If `csc.exe` is unavailable or compilation fails, it automatically falls back to a silent JScript launcher (`launch.js` via `wscript.exe`, found under **Show more options** on Windows 11).

Remove all menu entries cleanly at any time:

```bash
md-preview uninstall-menu
```

Both `install-menu` and `uninstall-menu` support `--dry-run` and are idempotent (safe to run repeatedly).

## Standalone CLI usage

Both `md-preview` and `kate-md-preview` invoke the same CLI:

```bash
# Open in your default web browser (starts/reuses a single local background daemon)
md-preview README.md

# Open in an app window (auto: Chromium/Edge/Brave -> Firefox chromeless -> Safari on macOS)
md-preview --app README.md

# Or explicitly pick the app-window browser
md-preview --app=firefox README.md
md-preview --app=chrome README.md
md-preview --app=safari README.md

# Run in the foreground (stops on Ctrl+C)
md-preview --foreground README.md

# Print the preview URL without opening a browser
md-preview --no-open README.md

# Check or stop the background preview daemon
md-preview --status
md-preview --stop
```

Passing a directory opens its `README.md` if present. Set `KATE_MD_PREVIEW_APP=1` (or `firefox`, `chrome`, `edge`, `brave`, `safari`) to default to `--app` window mode.

<details>
<summary>How <code>--app</code> works across browsers</summary>

- **Chrome / Chromium / Edge / Brave** (Linux, macOS, Windows): native `--app=<url>` chromeless window.
- **Firefox** (Linux, macOS, Windows): uses a dedicated preview profile in your cache directory (`user.js` + `chrome/userChrome.css`) to hide tabs and toolbars without touching your everyday Firefox profile. On macOS and Windows, all preview windows reuse this profile; on Linux, concurrent launches use an extra preview profile if the primary one is in use.
- **Safari** (macOS): opens a dedicated standalone Safari window via AppleScript (`osascript`), since Safari does not provide a native chromeless CLI flag.

</details>

## Editor integrations

Because the core server is completely editor-agnostic, you can bind `md-preview` to any editor:

- **Neovim**: `:!md-preview --app %:p`
- **Helix**: `:sh md-preview --app %{buffer_name}`
- **KDE Kate** (optional built-in installer): `kate-md-preview install-kate` / `kate-md-preview uninstall-kate`

<details>
<summary>KDE Kate setup & details</summary>

Register two user-level External Tools under `~/.config/kate/externaltools/` (without modifying Kate or system files):

```bash
kate-md-preview install-kate
```

- **Markdown Preview (GitHub)** — opens the current file in your default browser.
- **Markdown Preview (GitHub App Window)** — opens a chromeless app window suited for side-by-side tiling with Kate.

On Linux, `install-kate` also writes hidden desktop entries (`chrome-127.0.0.1__kate-md-preview-Default.desktop` and `kate-md-preview.desktop`, both `NoDisplay=true`) so Chromium and Firefox `--app` windows match Wayland `app_id` and show a crisp vector SVG taskbar icon.

**Using in Kate:**

1. Ensure the **External Tools** plugin is enabled (**Settings → Configure Kate → Plugins → External Tools**).
2. Restart Kate once so it loads the new entries.
3. Open any `.md` file and run **Tools → External Tools → Tools → Markdown Preview (GitHub)** (or **App Window**).
4. Optional: bind a shortcut in **Settings → Configure Keyboard Shortcuts** (search for `Markdown Preview`, e.g. `Ctrl+Shift+M`).
5. Saving (`Ctrl+S`) in Kate automatically refreshes the preview in place.

**Uninstall Kate bindings:**

```bash
kate-md-preview uninstall-kate
```

Both `install-kate` and `uninstall-kate` support `--dry-run` and are idempotent (existing shortcuts and other Kate tools are preserved).

</details>

## Security & runtime design

- The local HTTP server binds strictly to `127.0.0.1` on an ephemeral port.
- Registering files via `POST /api/open` requires a per-process random token stored in `$XDG_RUNTIME_DIR/kate-md-preview.json` (`0600`).
- Static file serving blocks directory traversal outside the registered repository/folder root.
- The background daemon exits automatically after 30 minutes of inactivity with zero connected preview tabs.
- All stylesheets, highlight themes, and KaTeX fonts are served locally from `node_modules`; only external image URLs explicitly referenced inside your Markdown (such as badges) are fetched by your browser.

## Development & testing

```bash
npm test
```

## License

[MIT](LICENSE)
