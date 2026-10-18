/**
 * Storage layer.
 *
 * Single place that knows how data is persisted in chrome.storage.local.
 * Every context (content script, popup, options page) uses this module
 * instead of touching chrome.storage directly.
 *
 * Storage keys:
 *  - `settings`      -> Settings object (see DEFAULT_SETTINGS in constants.ts)
 *  - `watchedVideos` -> map videoId -> WatchedVideoRecord
 */

import { DEFAULT_SETTINGS, SCHEMA_VERSION, STORAGE_KEYS } from './constants';
import type {
  DeepPartial,
  Settings,
  WatchedVideoInput,
  WatchedVideoRecord,
  WatchedVideosMap
} from './types';
import { clamp } from './utils';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively merges `patch` into `base`, returning a new object.
 * Neither argument is mutated.
 */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined | null): T {
  if (patch === undefined || patch === null) return base;
  if (!isPlainObject(patch)) return patch as T;

  const output: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    output[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return output as T;
}

/** Settings merged over the defaults. */
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return deepMerge(DEFAULT_SETTINGS, stored[STORAGE_KEYS.settings] as DeepPartial<Settings> | undefined);
}

/**
 * Deep-merges `patch` into the stored settings and persists the result.
 * @returns the full settings after the update.
 */
export async function updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  next.version = SCHEMA_VERSION;
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

/** Map videoId -> record. */
export async function getWatchedVideos(): Promise<WatchedVideosMap> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.watchedVideos);
  const value = stored[STORAGE_KEYS.watchedVideos] as unknown;
  if (isPlainObject(value)) return value as WatchedVideosMap;
  // Defensive: accept a legacy array format and convert it to a map.
  if (Array.isArray(value)) {
    const map: WatchedVideosMap = {};
    for (const record of value as WatchedVideoRecord[]) {
      if (record && typeof record.id === 'string') map[record.id] = record;
    }
    return map;
  }
  return {};
}

/** Removes the oldest entries (by lastWatchedAt) until maxEntries is met. */
function pruneWatchedMap(map: WatchedVideosMap, maxEntries: number | undefined): void {
  const limit =
    maxEntries !== undefined && Number.isFinite(maxEntries) && maxEntries > 0
      ? maxEntries
      : DEFAULT_SETTINGS.watched.maxEntries;
  const ids = Object.keys(map);
  if (ids.length <= limit) return;
  ids.sort((a, b) => (map[a]?.lastWatchedAt ?? 0) - (map[b]?.lastWatchedAt ?? 0));
  for (const id of ids.slice(0, ids.length - limit)) delete map[id];
}

export interface UpsertOptions {
  /**
   * True only on the first save of a watch session, so playCount counts real
   * plays instead of autosaves.
   */
  incrementPlayCount?: boolean;
  maxEntries?: number;
}

/**
 * Inserts or updates a watched-video record.
 *
 * `watchedSeconds` and `duration` are always kept at their maximum so a
 * later partial write can never shrink previously stored progress.
 */
export async function upsertWatchedVideo(
  record: WatchedVideoInput,
  options: UpsertOptions = {}
): Promise<WatchedVideoRecord | null> {
  if (!record || !record.id) return null;
  const { incrementPlayCount = false, maxEntries } = options;

  const map = await getWatchedVideos();
  const previous = map[record.id] ?? null;
  const now = Date.now();

  const duration = Math.max(Number(record.duration) || 0, previous?.duration ?? 0);
  const watchedSeconds = Math.max(Number(record.watchedSeconds) || 0, previous?.watchedSeconds ?? 0);

  const merged: WatchedVideoRecord = {
    id: record.id,
    title: record.title || previous?.title || '',
    channel: record.channel || previous?.channel || '',
    url: record.url || previous?.url || `https://www.youtube.com/watch?v=${record.id}`,
    duration,
    watchedSeconds,
    percent: duration > 0 ? clamp(Math.round((watchedSeconds / duration) * 100), 0, 100) : 0,
    firstWatchedAt: previous?.firstWatchedAt ?? now,
    lastWatchedAt: now,
    playCount: (previous?.playCount ?? 0) + (incrementPlayCount ? 1 : 0)
  };

  map[record.id] = merged;
  pruneWatchedMap(map, maxEntries);
  await chrome.storage.local.set({ [STORAGE_KEYS.watchedVideos]: map });
  return merged;
}

export async function removeWatchedVideo(id: string): Promise<void> {
  const map = await getWatchedVideos();
  if (!(id in map)) return;
  delete map[id];
  await chrome.storage.local.set({ [STORAGE_KEYS.watchedVideos]: map });
}

export async function clearWatchedVideos(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.watchedVideos);
}

/** Map -> array sorted by most recently watched, for UI rendering. */
export function watchedVideosToArray(map: WatchedVideosMap): WatchedVideoRecord[] {
  return Object.values(map ?? {}).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
}
