export function supportsColor({ stream = process.stdout, env = process.env } = {}) {
  if ("NO_COLOR" in env && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  if (env.TERM === "dumb") return false;
  return Boolean(stream?.isTTY);
}

export function createFormatter({ color = supportsColor() } = {}) {
  const wrap = (open, close = "\x1b[0m") =>
    color ? (text) => `${open}${text}${close}` : (text) => String(text);

  const bold = wrap("\x1b[1m");
  const dim = wrap("\x1b[2m");
  const underline = wrap("\x1b[4m");
  const red = wrap("\x1b[31m");
  const green = wrap("\x1b[32m");
  const yellow = wrap("\x1b[33m");
  const cyan = wrap("\x1b[36m");

  return {
    color,
    bold,
    dim,
    underline,
    red,
    green,
    yellow,
    cyan,
    url: (text) => (color ? `\x1b[36m\x1b[4m${text}\x1b[0m` : String(text)),
    ok: (text) => `${green("✓")} ${text}`,
    active: (text) => `${green("●")} ${text}`,
    idle: (text) => `${dim("○")} ${text}`,
    update: (text) => `${cyan("↻")} ${text}`,
    remove: (text) => `${yellow("−")} ${text}`,
    skip: (text) => `${dim("·")} ${text}`,
    dry: (text) => `${yellow("◦")} ${text}`,
    warn: (text) => `${yellow("▲")} ${yellow(bold("Warning:"))} ${text}`,
    err: (text) => `${red("✗")} ${text}`,
    note: (text) => `${cyan("ℹ")} ${dim(text)}`,
  };
}
