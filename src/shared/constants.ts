import type { CaptionLanguageOption, QualityLevelOption, Settings } from './types';

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
  { value: 'highres', label: 'Highest available' }
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
