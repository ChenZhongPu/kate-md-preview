import MarkdownIt from "markdown-it";
import GitHubAlerts from "markdown-it-github-alerts";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import katex from "katex";
import { render as peleRender } from "pele";

const PELE_LIMITS = {
  limit: 20_000,
  maxEdges: 500,
  outputLimit: 1_000_000,
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function githubSlugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, "")
    .replace(/\s+/g, "-");
}

function isValidMathDelim(state, pos) {
  const max = state.posMax;
  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

  let canOpen = true;
  let canClose = true;

  // Reject closing if preceded by space/tab, or followed by a digit (e.g. $5 and $10)
  if (
    prevChar === 0x20 /* space */ ||
    prevChar === 0x09 /* tab */ ||
    (nextChar >= 0x30 /* 0 */ && nextChar <= 0x39 /* 9 */)
  ) {
    canClose = false;
  }
  // Reject opening if followed by space/tab
  if (nextChar === 0x20 || nextChar === 0x09) {
    canOpen = false;
  }

  return { canOpen, canClose };
}

function mathInline(state, silent) {
  if (state.src[state.pos] !== "$") return false;

  // Handle $$...$$ inline display math
  if (state.src[state.pos + 1] === "$") {
    const start = state.pos + 2;
    let match = start;
    while ((match = state.src.indexOf("$$", match)) !== -1) {
      let backslashes = 0;
      for (let i = match - 1; i >= start && state.src[i] === "\\"; i--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) break;
      match += 2;
    }
    if (match === -1 || match === start) return false;
    if (!silent) {
      const token = state.push("math_block", "math", 0);
      token.markup = "$$";
      token.content = state.src.slice(start, match).trim();
    }
    state.pos = match + 2;
    return true;
  }

  const res = isValidMathDelim(state, state.pos);
  if (!res.canOpen) {
    if (!silent) state.pending += "$";
    state.pos += 1;
    return true;
  }

  const start = state.pos + 1;
  let match = start;
  while ((match = state.src.indexOf("$", match)) !== -1) {
    let pos = match - 1;
    while (pos >= start && state.src[pos] === "\\") pos--;
    if ((match - 1 - pos) % 2 === 0) break;
    match += 1;
  }

  if (match === -1) {
    if (!silent) state.pending += "$";
    state.pos = start;
    return true;
  }

  if (match - start === 0) {
    if (!silent) state.pending += "$$";
    state.pos = start + 1;
    return true;
  }

  const closeRes = isValidMathDelim(state, match);
  if (!closeRes.canClose) {
    if (!silent) state.pending += "$";
    state.pos = start;
    return true;
  }

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = state.src.slice(start, match);
  }
  state.pos = match + 1;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];

  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== "$$") {
    return false;
  }

  pos += 2;
  let firstLine = state.src.slice(pos, max);

  if (silent) return true;

  let found = false;
  let nextLine = startLine;
  let lastLine = "";

  if (firstLine.trim().endsWith("$$")) {
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

  while (!found) {
    nextLine++;
    if (nextLine >= endLine) break;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];
    if (pos < max && state.tShift[nextLine] < state.blkIndent) break;

    const lineText = state.src.slice(pos, max);
    if (lineText.trim().endsWith("$$")) {
      const lastPos = state.src.slice(0, max).lastIndexOf("$$");
      lastLine = state.src.slice(pos, lastPos);
      found = true;
    }
  }

  if (!found) return false;

  state.line = nextLine + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content =
    (firstLine && firstLine.trim() ? firstLine + "\n" : "") +
    state.getLines(startLine + 1, nextLine, state.tShift[startLine], true) +
    (lastLine && lastLine.trim() ? lastLine : "");
  token.map = [startLine, state.line];
  token.markup = "$$";
  return true;
}

function katexPlugin(md) {
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.after("blockquote", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, idx) => {
    try {
      return katex.renderToString(tokens[idx].content, {
        displayMode: false,
        throwOnError: false,
        strict: "ignore",
      });
    } catch (err) {
      return `<code class="katex-fallback-error" title="${escapeHtml(err.message)}">${escapeHtml(tokens[idx].content)}</code>`;
    }
  };

  md.renderer.rules.math_block = (tokens, idx) => {
    try {
      return `<div class="math-block">${katex.renderToString(tokens[idx].content, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      })}</div>\n`;
    } catch (err) {
      return `<pre class="katex-fallback-error"><code>${escapeHtml(tokens[idx].content)}</code></pre>\n`;
    }
  };
}

function headingAnchorsPlugin(md) {
  const defaultOpen =
    md.renderer.rules.heading_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const inlineToken = tokens[idx + 1];
    if (inlineToken && inlineToken.type === "inline") {
      const plainText = inlineToken.children
        ? inlineToken.children
            .filter((t) => t.type === "text" || t.type === "code_inline")
            .map((t) => t.content)
            .join("")
        : inlineToken.content;

      const baseSlug = githubSlugify(plainText) || "section";
      if (!env.__slugCounts) env.__slugCounts = new Map();
      const count = env.__slugCounts.get(baseSlug) || 0;
      env.__slugCounts.set(baseSlug, count + 1);
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      tokens[idx].attrSet("id", slug);
      if (!env.__firstTitle && tokens[idx].tag === "h1" && plainText.trim()) {
        env.__firstTitle = plainText.trim();
      }
    }
    return defaultOpen(tokens, idx, options, env, self);
  };
}

function createMarkdownRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code class="language-${escapeHtml(lang)}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
        } catch {
          // fall through
        }
      }
      return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
    },
  });

  md.use(katexPlugin);
  md.use(GitHubAlerts);
  md.use(taskLists, { enabled: false, label: true });
  md.use(headingAnchorsPlugin);

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = (token.info || "").trim().split(/\s+/)[0].toLowerCase();

    if (info === "mermaid") {
      const code = token.content;
      const diagramIdx = (env.__mermaidCount = (env.__mermaidCount || 0) + 1);
      try {
        const result = peleRender(code, {
          ...PELE_LIMITS,
          idPrefix: `pele-${diagramIdx}`,
        });
        const minWidthStyle = result.width
          ? ` style="min-width: ${Math.min(Math.ceil(result.width * 0.75), 900)}px"`
          : "";
        return `<div class="pele-mermaid"><div class="pele-mermaid-diagram"${minWidthStyle}>${result.svg}</div></div>\n`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return (
          `<div class="pele-mermaid pele-mermaid-failed">` +
          `<div class="pele-mermaid-error">Mermaid render error (pele): ${escapeHtml(msg)}</div>` +
          `<pre class="hljs"><code class="language-mermaid">${escapeHtml(code)}</code></pre>` +
          `</div>\n`
        );
      }
    }

    if (info === "math") {
      try {
        return `<div class="math-block">${katex.renderToString(token.content.trim(), {
          displayMode: true,
          throwOnError: false,
          strict: "ignore",
        })}</div>\n`;
      } catch (err) {
        return `<pre class="katex-fallback-error"><code>${escapeHtml(token.content)}</code></pre>\n`;
      }
    }

    return defaultFence(tokens, idx, options, env, self);
  };

  return md;
}

const md = createMarkdownRenderer();

export function renderMarkdown(source) {
  const env = {};
  const html = md.render(source, env);
  return {
    html,
    title: env.__firstTitle || null,
  };
}
