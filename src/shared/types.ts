/**
 * Shared data types. Kept in one file so every module agrees on the shapes.
 */

import type { MessageKey } from './i18n';

export type QualityValue =
  | 'auto'
  | 'tiny'
  | 'small'
  | 'medium'
  | 'large'
  | 'hd720'
  | 'hd1080'
  | 'hd1440'
  | 'hd2160'
  | 'hd2880'
  | 'hd4320'
  | 'highres';

export interface QualityLevelOption {
  value: QualityValue;
  /** Static label ("144p", "2160p (4K)"); resolution numbers need no translation. */
  label: string;
  /** i18n key for labels that are words (e.g. "Highest available"). */
  labelKey?: MessageKey;
}

export interface CaptionLanguageOption {
  code: string;
  name: string;
}

export interface WatchedSettings {
  enabled: boolean;
  minSeconds: number;
  maxEntries: number;
}

export interface QualitySettings {
  enabled: boolean;
  value: QualityValue;
}

export interface CaptionsSettings {
  enabled: boolean;
  language: string;
}

/**
 * How far behind the live edge playback may sit. `real-time` is the smallest
 * possible delay; the numeric options are safety cushions for connections
 * that cannot hold the edge without stuttering.
 */
export type LiveDelayBuffer = 'real-time' | '2s' | '5s' | '10s';

export interface LiveDelayOption {
  value: LiveDelayBuffer;
  /** i18n key for the option label shown in the settings UI. */
  labelKey: MessageKey;
  /** Seconds of cushion kept behind the live edge (0 = real time). */
  seconds: number;
  /** i18n key for the connection-oriented explanation shown in the UI. */
  hintKey: MessageKey;
}

export interface LiveDelaySettings {
  /** Keeps live playback close to the live edge (live streams only). */
  enabled: boolean;
  buffer: LiveDelayBuffer;
}

export interface SkipSettings {
  /** Shows the "Next video" button on already-watched videos. */
  enabled: boolean;
  /** Advances to the next video automatically (requires `enabled`). */
  autoSkip: boolean;
}

export interface Settings {
  version: number;
  debug: boolean;
  watched: WatchedSettings;
  quality: QualitySettings;
  captions: CaptionsSettings;
  liveDelay: LiveDelaySettings;
  skip: SkipSettings;
}

export interface WatchedVideoRecord {
  id: string;
  title: string;
  channel: string;
  url: string;
  duration: number;
  watchedSeconds: number;
  percent: number;
  firstWatchedAt: number;
  lastWatchedAt: number;
  playCount: number;
}

export type WatchedVideosMap = Record<string, WatchedVideoRecord>;

/** What the content script sends to storage; storage fills in the rest. */
export interface WatchedVideoInput {
  id: string;
  url?: string;
  title?: string;
  channel?: string;
  duration?: number;
  watchedSeconds?: number;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
