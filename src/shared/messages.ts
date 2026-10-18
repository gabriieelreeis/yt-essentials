import type { PlayerSettings } from './youtube-player';

/**
 * Message protocol between the isolated content script and the MAIN world
 * script (both share the page's `window`, so `window.postMessage` is used).
 */

export const MESSAGE_CHANNEL = 'yt-essentials';

export interface SettingsMessage {
  channel: typeof MESSAGE_CHANNEL;
  type: 'settings';
  settings: PlayerSettings;
}

export interface RequestSettingsMessage {
  channel: typeof MESSAGE_CHANNEL;
  type: 'request-settings';
}

/**
 * Asks the MAIN world to advance to the next video through the player API.
 * Used as a fallback when YouTube's native next button is not found in the DOM.
 */
export interface AdvanceMessage {
  channel: typeof MESSAGE_CHANNEL;
  type: 'advance';
}

export type ExtensionMessage = SettingsMessage | RequestSettingsMessage | AdvanceMessage;

/** Narrowing helper for message events; returns null for foreign messages. */
export function readExtensionMessage(data: unknown): ExtensionMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { channel?: unknown; type?: unknown };
  if (candidate.channel !== MESSAGE_CHANNEL) return null;
  if (
    candidate.type === 'settings' ||
    candidate.type === 'request-settings' ||
    candidate.type === 'advance'
  ) {
    return data as ExtensionMessage;
  }
  return null;
}
