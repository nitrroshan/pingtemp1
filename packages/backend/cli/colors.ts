/**
 * CLI Color Helpers
 *
 * ANSI color utilities shared across all CLI modules.
 */

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

export const c = {
  success: (s: string) => `${colors.green}${s}${colors.reset}`,
  error: (s: string) => `${colors.red}${s}${colors.reset}`,
  warn: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  info: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  cmd: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  header: (s: string) =>
    `${colors.bright}${colors.bgBlue} ${s} ${colors.reset}`,
  workerHeader: (s: string) =>
    `${colors.bright}${colors.bgMagenta} ${s} ${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  bold: (s: string) => `${colors.bright}${s}${colors.reset}`,
  role: (s: string) => `${colors.bright}${colors.cyan}${s}${colors.reset}`,
};
