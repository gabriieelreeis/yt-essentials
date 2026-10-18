import type { CaptionLanguageOption, LiveDelayOption, QualityLevelOption, Settings } from './types';

export const APP_NAME = 'YT Essentials';
export const SCHEMA_VERSION = 1;
export const LOG_PREFIX = '[YT Essentials]';

/** Keys used inside chrome.storage.local. */
export const STORAGE_KEYS = {
  settings: 'settings',
  watchedVideos: 'watchedVideos'
} as const;

/**
 * Minimum watched percentage (from a previous session) for a video to count as
 * "already watched". When that happens the content script offers a "Next video"
 * button over the player (never on live streams).
 */
export const ALREADY_WATCHED_PERCENT = 90;

/**
 * Default settings. Treat as immutable: `deepMerge` in storage.ts always
 * returns copies, so nothing ever mutates this object.
 * Adding a new key here is enough to ship a new option with a default value.
 */
export const DEFAULT_SETTINGS: Settings = {
  version: SCHEMA_VERSION,
  debug: false,
  watched: {
    enabled: true,
    minSeconds: 5,
    maxEntries: 2000
  },
  quality: {
    enabled: false,
    value: 'hd1080'
  },
  captions: {
    enabled: false,
    language: 'en'
  },
  liveDelay: {
    enabled: false,
    buffer: '2s'
  },
  skip: {
    enabled: true,
    autoSkip: false
  }
};

/** YouTube quality ids ordered from lowest to highest ('highres' = above 1080p). */
export const QUALITY_LEVELS: readonly QualityLevelOption[] = [
  { value: 'tiny', label: '144p' },
  { value: 'small', label: '240p' },
  { value: 'medium', label: '360p' },
  { value: 'large', label: '480p' },
  { value: 'hd720', label: '720p' },
  { value: 'hd1080', label: '1080p' },
  { value: 'hd1440', label: '1440p' },
  { value: 'hd2160', label: '2160p (4K)' },
  { value: 'hd2880', label: '2880p (5K)' },
  { value: 'hd4320', label: '4320p (8K)' },
  { value: 'highres', label: 'Highest available', labelKey: 'qualityHighest' }
];

/** Caption languages offered in the UI (YouTube/BCP-47 codes). */
export const CAPTION_LANGUAGES: readonly CaptionLanguageOption[] = [
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)' },
  { code: 'id', name: 'Indonesian' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'el', name: 'Greek' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' }
];

/**
 * Live-delay buffers: how far behind the live edge playback is allowed to sit.
 * The numeric part is the cushion; each hint explains which connection profile
 * the buffer is for (shown under the select in the popup/options).
 */
export const LIVE_DELAY_OPTIONS: readonly LiveDelayOption[] = [
  {
    value: 'real-time',
    labelKey: 'liveDelayRealTime',
    seconds: 0,
    hintKey: 'liveDelayRealTimeHint'
  },
  {
    value: '2s',
    labelKey: 'liveDelay2s',
    seconds: 2,
    hintKey: 'liveDelay2sHint'
  },
  {
    value: '5s',
    labelKey: 'liveDelay5s',
    seconds: 5,
    hintKey: 'liveDelay5sHint'
  },
  {
    value: '10s',
    labelKey: 'liveDelay10s',
    seconds: 10,
    hintKey: 'liveDelay10sHint'
  }
];

/** Cadence of the live-delay check in the MAIN world. */
export const LIVE_DELAY_CHECK_INTERVAL_MS = 1000;
/** Start catching up when the delay exceeds the buffer by this much. */
export const LIVE_DELAY_TOLERANCE_S = 1.5;
/** While catching up, stop when the delay is back within buffer + this margin. */
export const LIVE_DELAY_STOP_MARGIN_S = 0.5;
/** Playback rate used to catch up to the live target (closes the delay at rate−1 per second). */
export const LIVE_CATCH_UP_RATE = 1.5;
