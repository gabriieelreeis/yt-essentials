import { LOG_PREFIX } from './constants';

/**
 * Minimal logger. `debug` output is opt-in through the `debug` setting;
 * warnings and errors are always printed.
 */
export const logger = {
  enabled: false,

  setEnabled(value: boolean): void {
    logger.enabled = value;
  },

  debug(...args: unknown[]): void {
    if (logger.enabled) console.debug(LOG_PREFIX, ...args);
  },

  info(...args: unknown[]): void {
    console.info(LOG_PREFIX, ...args);
  },

  warn(...args: unknown[]): void {
    console.warn(LOG_PREFIX, ...args);
  },

  error(...args: unknown[]): void {
    console.error(LOG_PREFIX, ...args);
  }
};
