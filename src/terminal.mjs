export function supportsColor({ stream = process.stdout, env = process.env } = {}) {
  if ("NO_COLOR" in env && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  if (env.TERM === "dumb") return false;
  if (!stream?.isTTY) return false;
  if (typeof stream.hasColors === "function") {
    return stream.hasColors(env);
  }
  return true;
}

export function supportsUnicode({
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform !== "win32") {
    const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
    if (/^(C|POSIX)$/i.test(locale.trim())) return false;
    return env.TERM !== "linux";
  }

  return Boolean(
    env.WT_SESSION ||
      env.TERM_PROGRAM === "vscode" ||
      env.TERM_PROGRAM === "WezTerm" ||
      env.TERM_PROGRAM === "mintty" ||
      env.WEZTERM_EXECUTABLE ||
      env.ALACRITTY_LOG ||
      env.TERMINUS_SUBLIME ||
      env.MSYSTEM ||
      env.ConEmuTask === "{cmd::Cmder}" ||
      env.TERMINAL_EMULATOR === "JetBrains-JediTerm" ||
      env.TERM === "xterm-256color" ||
      env.TERM === "alacritty"
  );
}

const UNICODE_GLYPHS = {
  brand: "◆",
  ok: "✓",
  active: "●",
  idle: "○",
  update: "↻",
  remove: "−",
  skip: "·",
  dry: "◦",
  warn: "▲",
  err: "✗",
  note: "ℹ",
  arrow: "→",
  sep: "·",
};

const ASCII_GLYPHS = {
  brand: "*",
  ok: "+",
  active: "*",
  idle: "o",
  update: "~",
  remove: "-",
  skip: ".",
  dry: "-",
  warn: "!",
  err: "x",
  note: "i",
  arrow: "->",
  sep: "|",
};

export function createFormatter({
  color = supportsColor(),
  unicode = supportsUnicode(),
} = {}) {
  const wrap = (open, close = "\x1b[0m") =>
    color ? (text) => `${open}${text}${close}` : (text) => String(text);

  const g = unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
  const bold = wrap("\x1b[1m");
  const dim = wrap("\x1b[2m");
  const underline = wrap("\x1b[4m");
  const red = wrap("\x1b[31m");
  const green = wrap("\x1b[32m");
  const yellow = wrap("\x1b[33m");
  const cyan = wrap("\x1b[36m");

  return {
    color,
    unicode,
    glyphs: g,
    bold,
    dim,
    underline,
    red,
    green,
    yellow,
    cyan,
    url: (text) => (color ? `\x1b[36m\x1b[4m${text}\x1b[0m` : String(text)),
    brand: (text) => `${cyan(g.brand)} ${text}`,
    ok: (text) => `${green(g.ok)} ${text}`,
    active: (text) => `${green(g.active)} ${text}`,
    idle: (text) => `${dim(g.idle)} ${text}`,
    update: (text) => `${cyan(g.update)} ${text}`,
    remove: (text) => `${yellow(g.remove)} ${text}`,
    skip: (text) => `${dim(g.skip)} ${text}`,
    dry: (text) => `${yellow(g.dry)} ${text}`,
    warn: (text) => `${yellow(g.warn)} ${yellow(bold("Warning:"))} ${text}`,
    err: (text) => `${red(g.err)} ${text}`,
    note: (text) => `${cyan(g.note)} ${dim(text)}`,
    banner: ({ version, subtitle = "", active = true } = {}) => {
      const [m1, m2, m3] = unicode
        ? [bold("█▄ ▄█  █▀▀▄"), bold("█ ▀ █  █  █"), bold("█   █  █▄▄▀")]
        : [bold("|\\ /|  |--."), bold("| V |  |  |"), bold("|   |  |--'")];
      const eyeTop = dim(unicode ? " ╱─────╲ " : " /-----\\ ");
      const eyeMid = active
        ? `${dim("<  ")}${cyan(unicode ? "(●)" : "(o)")}${dim("  >")}`
        : dim(unicode ? "<  ───  >" : "<  ---  >");
      const eyeBot = dim(unicode ? " ╲─────╱ " : " \\-----/ ");
      const title = `${bold("kate-md-preview")} ${dim(`v${version}`)}`;
      const sub = subtitle ? dim(subtitle) : "";
      return [
        `  ${m1}    ${eyeTop}`,
        `  ${m2}    ${eyeMid}   ${title}`,
        `  ${m3}    ${eyeBot}${sub ? `   ${sub}` : ""}`,
      ].join("\n");
    },
  };
}
