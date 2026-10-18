/** Small pure helpers shared by every context. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Seconds -> "12:34" or "1:02:03". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** Timestamp (ms) -> "just now", "5 minutes ago", "3 days ago", ... */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = Number(timestamp) - Date.now();
  if (!Number.isFinite(diffMs)) return '';
  const diff = Math.abs(diffMs);
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['week', 604800000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000]
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, unitMs] of units) {
    if (diff >= unitMs) return formatter.format(Math.round(diffMs / unitMs), unit);
  }
  return 'just now';
}

/**
 * Extracts the video id from a YouTube URL.
 * Handles /watch?v=, /shorts/<id>, /live/<id> and /embed/<id>.
 */
export function parseVideoIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, 'https://www.youtube.com');
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    if (url.pathname === '/watch') return url.searchParams.get('v') || null;
    const match = url.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    return match?.[2] ?? null;
  } catch {
    return null;
  }
}
