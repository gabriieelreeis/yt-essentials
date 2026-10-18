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
  liveDelay: {
    enabled: false,
    cushionSeconds: 5
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
 * Live-delay engine tuning (seconds unless noted). The engine regulates the
 * "buffer" (media downloaded ahead of the playhead) around the cushion the
 * user picks in the settings: a surplus above it is spent by speeding playback
 * up, a deficit is rebuilt by slowing down a touch below 1x. This is the
 * control loop the reference extension ZeroDelay validated on real streams
 * (its "Personalizado" mode); the values are tuned for ~250 ms ticks (see
 * `LIVE_DELAY_TICK_MIN_MS`).
 */

/** Cushion slider bounds, step, and default (the popup/options control). */
export const LIVE_CUSHION_MIN_SECONDS = 1;
export const LIVE_CUSHION_MAX_SECONDS = 10;
export const LIVE_CUSHION_STEP_SECONDS = 0.5;
export const LIVE_CUSHION_DEFAULT_SECONDS = 5;
/** Minimum gap between live-delay ticks (~4/s while the media advances). */
export const LIVE_DELAY_TICK_MIN_MS = 200;
/** Fallback cadence while the media is not advancing (paused/loading). */
export const LIVE_DELAY_IDLE_INTERVAL_MS = 1000;
/** Minimum gap between live-status messages sent to the isolated world. */
export const LIVE_DELAY_PUBLISH_MS = 1000;
/** Playback rates are written on this grid (avoids endless micro-writes). */
export const LIVE_RATE_STEP = 0.05;
/** Top catch-up speed while spending surplus buffer. */
export const LIVE_CATCH_UP_RATE = 1.5;
/** Rate gain per second of buffer above the cushion (0.08 x 1 s = 1.08x). */
export const LIVE_REGULATE_GAIN_UP = 0.08;
/** Rate cut per second of buffer below the cushion (0.15 x 0.67 s = floor). */
export const LIVE_REGULATE_GAIN_DOWN = 0.15;
/** Slowest rebuild rate (imperceptible; regrows a thin cushion). */
export const LIVE_REBUILD_FLOOR_RATE = 0.9;
/** The rebuild fade: it eases out as latency climbs toward this ceiling... */
export const LIVE_DRIFT_CEIL_S = 22;
/** ...over this many seconds (the jump-to-live backstop is the failsafe). */
export const LIVE_DRIFT_SPAN_S = 6;
/** Jump straight to the live edge when playback falls this far behind... */
export const LIVE_SKIP_TO_LIVE_S = 30;
/** ...re-arming only once the latency recovers below half of it. */
export const LIVE_SKIP_REARM_S = LIVE_SKIP_TO_LIVE_S / 2;
