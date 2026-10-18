/**
 * Shared data types. Kept in one file so every module agrees on the shapes.
 */

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
  label: string;
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
