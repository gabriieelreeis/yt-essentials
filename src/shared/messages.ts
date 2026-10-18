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

/**
 * Live-delay data published by the MAIN world while the option is on and a
 * live stream is detected. The isolated world uses it to draw the badge inside
 * the player; when messages stop arriving the badge goes away.
 */
export interface LiveStatusMessage {
  channel: typeof MESSAGE_CHANNEL;
  type: 'live-status';
  /** True latency against the live edge, in seconds; null when unmeasurable. */
  latencySeconds: number | null;
  /** Media downloaded ahead of the playhead, in seconds; null when unmeasurable. */
  bufferSeconds: number | null;
  /** True while the engine is speeding playback up to catch the live edge. */
  catchingUp: boolean;
  /** Playback rate the engine is holding (1 = normal). */
  catchUpRate: number;
}

export type ExtensionMessage =
  | SettingsMessage
  | RequestSettingsMessage
  | AdvanceMessage
  | LiveStatusMessage;

/** Narrowing helper for message events; returns null for foreign messages. */
export function readExtensionMessage(data: unknown): ExtensionMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { channel?: unknown; type?: unknown };
  if (candidate.channel !== MESSAGE_CHANNEL) return null;
  if (
    candidate.type === 'settings' ||
    candidate.type === 'request-settings' ||
    candidate.type === 'advance' ||
    candidate.type === 'live-status'
  ) {
    return data as ExtensionMessage;
  }
  return null;
}
