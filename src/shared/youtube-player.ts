/**
 * Pure helpers for talking to the YouTube player (`#movie_player`).
 *
 * Everything here is framework-agnostic and MUST NOT touch chrome.* APIs:
 * the module is bundled into the MAIN world content script, which runs
 * inside the page and has no access to extension APIs.
 */

/** YouTube quality ids ordered from lowest to highest. */
export const QUALITY_ORDER = [
  'tiny',
  'small',
  'medium',
  'large',
  'hd720',
  'hd1080',
  'hd1440',
  'hd2160',
  'hd2880',
  'hd4320',
  'highres'
] as const;

export interface PlayerVideoData {
  video_id?: string;
  isLive?: boolean;
}

/**
 * Snapshot returned by `player.getProgressState()`. On live streams
 * `seekableEnd` is the live edge, in the same time scale as `current`.
 */
export interface PlayerProgressState {
  current?: number;
  duration?: number;
  seekableStart?: number;
  seekableEnd?: number;
  isLive?: boolean;
  isSeekable?: boolean;
  isAtLiveHead?: boolean;
}

/**
 * The subset of the (undocumented) YouTube player API this extension uses.
 * Every member is optional: the API is internal and may disappear.
 */
export interface YouTubePlayerElement extends HTMLElement {
  getAvailableQualityLevels?: () => string[];
  getPlaybackQuality?: () => string;
  setPlaybackQualityRange?: (minQuality?: string, maxQuality?: string) => void;
  setPlaybackQuality?: (quality: string) => void;
  getOption?: (moduleName: string, option: string) => unknown;
  setOption?: (moduleName: string, option: string, value: unknown) => void;
  loadModule?: (moduleName: string) => void;
  /** Advances to the next video (same action as YouTube's next button). */
  nextVideo?: () => void;
  /** Progress snapshot (current time, live edge, seekability). */
  getProgressState?: () => PlayerProgressState | undefined;
  /** Numeric player state (-1 unstarted, 1 playing, 2 paused, 3 buffering). */
  getPlayerState?: () => number;
  getVideoData?: () => PlayerVideoData | undefined;
  /** Playback speed (1 = normal); lives catch up by raising this temporarily. */
  getPlaybackRate?: () => number;
  setPlaybackRate?: (rate: number) => void;
}

export interface CaptionTrackInfo {
  languageCode?: string;
  kind?: string;
  translationLanguages?: { languageCode?: string }[];
}

export interface CaptionTrackChoice {
  track: {
    languageCode: string;
    translationLanguage?: { languageCode: string };
  };
  reload?: boolean;
}

/** Settings snapshot the isolated world sends to the MAIN world. */
export interface PlayerSettings {
  debug?: boolean;
  quality?: { enabled: boolean; value: string };
  captions?: { enabled: boolean; language: string };
  liveDelay?: { enabled: boolean; buffer: string };
}

export function getPlayerElement(): YouTubePlayerElement | null {
  const element = document.getElementById('movie_player') ?? document.getElementById('shorts-player');
  return (element as YouTubePlayerElement | null) ?? null;
}

/**
 * Seconds playback sits behind the live edge (`seekableEnd - current`).
 * Returns null when the snapshot has no usable numbers; callers must make
 * sure the stream is actually live before trusting the value.
 */
export function liveEdgeDelay(progress: PlayerProgressState | null | undefined): number | null {
  if (!progress) return null;
  const current = Number(progress.current);
  const end = Number(progress.seekableEnd);
  if (!Number.isFinite(current) || !Number.isFinite(end)) return null;
  return Math.max(0, end - current);
}

export function qualityRank(quality: string): number {
  return (QUALITY_ORDER as readonly string[]).indexOf(quality);
}

/**
 * Resolves the desired quality id against what the video actually offers.
 * When the requested quality is unavailable, the best quality *below* it is
 * used; when nothing is below, the lowest available quality is used.
 */
export function pickQuality(available: string[], requested: string): string | null {
  const ranked = available
    .filter((quality) => qualityRank(quality) >= 0)
    .sort((a, b) => qualityRank(a) - qualityRank(b));
  if (ranked.length === 0) return null;

  const targetRank = qualityRank(requested);
  if (targetRank < 0) return ranked[ranked.length - 1] ?? null;

  const atOrBelow = ranked.filter((quality) => qualityRank(quality) <= targetRank);
  return atOrBelow[atOrBelow.length - 1] ?? ranked[0] ?? null;
}

/**
 * Picks the caption track for `language`:
 *  1. auto-generated (ASR) track in the language;
 *  2. manual track in the language;
 *  3. translation of any track into the language.
 */
export function pickCaptionTrack(tracks: CaptionTrackInfo[], language: string): CaptionTrackChoice | null {
  const target = String(language || '').toLowerCase();
  const targetBase = target.split('-')[0] ?? target;

  const matchesLanguage = (code: string | undefined): boolean => {
    const candidate = String(code || '').toLowerCase();
    return candidate === target || candidate.split('-')[0] === targetBase;
  };

  const candidates = tracks.filter((track) => matchesLanguage(track.languageCode));
  const autoGenerated = candidates.find((track) => track.kind === 'asr');
  if (autoGenerated?.languageCode) {
    return { track: { languageCode: autoGenerated.languageCode } };
  }
  const manual = candidates.find((track) => track.languageCode);
  if (manual?.languageCode) {
    return { track: { languageCode: manual.languageCode } };
  }

  for (const track of tracks) {
    if (!track.languageCode) continue;
    const translations = Array.isArray(track.translationLanguages) ? track.translationLanguages : [];
    const translation = translations.find((item) => matchesLanguage(item.languageCode));
    if (translation?.languageCode) {
      return {
        track: {
          languageCode: track.languageCode,
          translationLanguage: { languageCode: translation.languageCode }
        },
        reload: true
      };
    }
  }

  return null;
}

export function isSameTrack(current: CaptionTrackInfo | null | undefined, desired: CaptionTrackChoice['track'] | null | undefined): boolean {
  if (!current || !desired) return false;
  if (String(current.languageCode || '').toLowerCase() !== String(desired.languageCode).toLowerCase()) {
    return false;
  }
  const currentTranslation = current.translationLanguages?.[0]?.languageCode ?? '';
  const desiredTranslation = desired.translationLanguage?.languageCode ?? '';
  return String(currentTranslation) === String(desiredTranslation);
}
