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
 * Snapshot returned by `player.getProgressState()`. Used only to confirm a
 * stream is live; the live-delay engine steers off `getStatsForNerds()`
 * (`seekableEnd − current` stays near zero even 20 s behind live).
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
 * The subset of `player.getStatsForNerds()` used to steer the live catch-up.
 * Fields are strings ("23.4"), and `"-"` when the player cannot measure them.
 */
export interface PlayerLiveStats {
  /** Latency against the true live edge, in seconds. */
  live_latency_secs?: string | number;
  /** Media downloaded ahead of the playhead, in seconds. */
  buffer_health_seconds?: string | number;
  /** Non-empty means special latency handling: not a reducible live. */
  live_latency_style?: string;
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
  /** Progress snapshot (live detection only; see PlayerProgressState). */
  getProgressState?: () => PlayerProgressState | undefined;
  /** Raw "stats for nerds" values used by the live-delay engine. */
  getStatsForNerds?: () => PlayerLiveStats | undefined;
  /** Numeric player state (-1 unstarted, 1 playing, 2 paused, 3 buffering). */
  getPlayerState?: () => number;
  getVideoData?: () => PlayerVideoData | undefined;
  /** Jumps the playhead to the live edge (backstop for huge backlogs). */
  seekToLiveHead?: () => void;
  /** Starts playback (defensive call after a live-edge jump). */
  playVideo?: () => void;
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
  /** Live-delay toggle; the safety cushion is chosen automatically. */
  liveDelay?: { enabled: boolean };
}

export function getPlayerElement(): YouTubePlayerElement | null {
  const element = document.getElementById('movie_player') ?? document.getElementById('shorts-player');
  return (element as YouTubePlayerElement | null) ?? null;
}

/** Live signals fed to the catch-up controller (both required to steer). */
export interface LivePlaybackStats {
  /** True latency against the live edge, in seconds. */
  latencySeconds: number | null;
  /** Media downloaded ahead of the playhead, in seconds. */
  bufferSeconds: number | null;
}

/** Parses a stats-for-nerds numeric field ("23.4"); null when unmeasurable. */
export function parseStatSeconds(value: string | number | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads the live control signals from the player. `live_latency_secs` is the
 * real latency — the angle the user perceives — while `buffer_health_seconds`
 * (media downloaded ahead of the playhead) is the part playback speed can
 * actually spend. A non-empty `live_latency_style` marks streams with special
 * latency handling, where the engine must not act. The buffer falls back to
 * the <video> element's last buffered range when the stats are missing.
 */
export function readLiveStats(player: YouTubePlayerElement): LivePlaybackStats {
  let latencySeconds: number | null = null;
  let bufferSeconds: number | null = null;

  try {
    const stats = player.getStatsForNerds?.();
    const style = stats?.live_latency_style;
    if (stats && (style === undefined || style === '')) {
      latencySeconds = parseStatSeconds(stats.live_latency_secs);
      bufferSeconds = parseStatSeconds(stats.buffer_health_seconds);
    }
  } catch {
    /* the stats API is best effort */
  }

  if (bufferSeconds === null) bufferSeconds = bufferedAheadSeconds(player);
  return { latencySeconds, bufferSeconds };
}

/** End of the last buffered range minus the playhead (buffer fallback). */
function bufferedAheadSeconds(player: YouTubePlayerElement): number | null {
  try {
    const video = player.querySelector('video');
    if (!video || video.buffered.length === 0) return null;
    const ahead = video.buffered.end(video.buffered.length - 1) - video.currentTime;
    return Number.isFinite(ahead) ? Math.max(0, ahead) : null;
  } catch {
    return null;
  }
}

/** Jumps through the player API to the live edge; false when unavailable. */
export function seekToLiveHead(player: YouTubePlayerElement): boolean {
  if (typeof player.seekToLiveHead !== 'function') return false;
  try {
    player.seekToLiveHead();
    return true;
  } catch {
    return false;
  }
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
