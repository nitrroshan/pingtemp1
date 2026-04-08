/**
 * Frontend logger — level-aware console wrapper.
 *
 * In production builds (import.meta.env.PROD), debug and info are suppressed.
 * Error and warn always log.
 */

const isProduction = import.meta.env.PROD;

export const logger = {
  debug(...args: unknown[]) {
    if (!isProduction) console.debug(...args);
  },
  info(...args: unknown[]) {
    if (!isProduction) console.log(...args);
  },
  warn(...args: unknown[]) {
    console.warn(...args);
  },
  error(...args: unknown[]) {
    console.error(...args);
  },
};
