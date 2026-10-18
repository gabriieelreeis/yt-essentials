/**
 * Watch-history page reader (youtube.com/feed/history), used by the content
 * script to import videos watched BEFORE the extension was installed.
 *
 * The page is a regular YouTube browse list: batches of `ytd-video-renderer`
 * cards grouped in `ytd-item-section-renderer` sections (one per day), loaded
 * lazily as the page scrolls (the caller drives the scrolling). Everything is
 * read from the rendered DOM — the isolated world cannot see the page's
 * `ytInitialData` JavaScript object — and every selector is defensive: a
 * layout change yields fewer items, never an exception.
 */

import { clamp } from './utils';

/** One video card found on the history page. */
export interface HistoryItem {
  id: string;
  title: string;
  channel: string;
  /** Duration in seconds (0 when the card has no clock badge, e.g. lives). */
  durationSeconds: number;
  /** Watched percentage from the thumbnail progress bar (0 when absent). */
  percent: number;
  /** Approximate last-watched time; day granularity (see dayTimestamp). */
  watchedAt: number;
}

const DAY_MS = 86400000;

/** "Today" section names across the locales the extension speaks, lowercased. */
const TODAY_WORDS = new Set(['today', 'hoje', 'hoy', 'сегодня', 'heute']);
const YESTERDAY_WORDS = new Set(['yesterday', 'ontem', 'ayer', 'вчера', 'gestern']);

/** Parsed card per renderer element, re-validated by the card's href. */
const cardCache = new WeakMap<Element, { href: string; item: HistoryItem | null }>();

/** True when the current page is the watch-history list. */
export function isHistoryPage(): boolean {
  return location.pathname === '/feed/history';
}

/** How many possibly-importable cards the page has rendered so far. */
export function countHistoryCards(): number {
  return document.querySelectorAll('ytd-video-renderer').length;
}

/**
 * Reads every rendered card. Parsed cards are cached per element and re-read
 * only when YouTube reuses the element for another video (the href changes),
 * so a long crawl never re-parses the whole list from scratch.
 */
export function collectHistoryItems(now = Date.now()): HistoryItem[] {
  const sections = Array.from(document.querySelectorAll('ytd-item-section-renderer'));
  const items: HistoryItem[] = [];
  for (const renderer of document.querySelectorAll<HTMLElement>('ytd-video-renderer')) {
    const link = renderer.querySelector<HTMLAnchorElement>(
      'a#video-title, a#thumbnail, a[href*="/watch?v="]'
    );
    const href = link?.getAttribute('href') ?? '';
    const cached = cardCache.get(renderer);
    if (cached && cached.href === href) {
      if (cached.item) items.push(cached.item);
      continue;
    }
    const item = extractItem(renderer, link, sections, now);
    cardCache.set(renderer, { href, item });
    if (item) items.push(item);
  }
  return items;
}

function extractItem(
  renderer: HTMLElement,
  link: HTMLAnchorElement | null,
  sections: Element[],
  now: number
): HistoryItem | null {
  const id = videoIdFromHref(link?.getAttribute('href') ?? '');
  if (!id) return null; // Shorts/playlist cards use other renderers: keep only videos.

  const titleNode = renderer.querySelector('#video-title');
  const title = (titleNode?.textContent ?? link?.getAttribute('title') ?? '').trim();
  const channel =
    renderer
      .querySelector('ytd-channel-name #text a, ytd-channel-name a')
      ?.textContent?.trim() ?? '';
  const durationSeconds = parseClockSeconds(
    renderer.querySelector('ytd-thumbnail-overlay-time-status-renderer')?.textContent ?? ''
  );
  const percent = readWatchedPercent(renderer);

  const section = renderer.closest('ytd-item-section-renderer');
  const sectionIndex = section ? sections.indexOf(section) : sections.length;
  const watchedAt = dayTimestamp(
    section ? sectionHeaderText(section) : null,
    Math.max(sectionIndex, 0),
    now
  );

  return { id, title, channel, durationSeconds, percent, watchedAt };
}

function videoIdFromHref(href: string): string {
  try {
    const url = new URL(href, location.origin);
    return url.pathname === '/watch' ? url.searchParams.get('v') ?? '' : '';
  } catch {
    return '';
  }
}

/** The red progress bar ("width: 57%") -> 57. Cards without one yield 0. */
function readWatchedPercent(renderer: HTMLElement): number {
  const progress = renderer.querySelector<HTMLElement>(
    'ytd-thumbnail-overlay-resume-playback-renderer #progress'
  );
  const width = Number.parseFloat(progress?.style.width ?? '');
  return Number.isFinite(width) ? clamp(Math.round(width), 0, 100) : 0;
}

/** "12:34" / "1:02:03" -> seconds. Missing or non-clock badges ("LIVE") yield 0. */
function parseClockSeconds(text: string): number {
  const parts = text
    .trim()
    .split(':')
    .map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Day text of a section header ("Today", "Yesterday", a date), or null. */
function sectionHeaderText(section: Element): string | null {
  const header = section.querySelector('#header');
  const text = header?.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
  // The length guard keeps a layout change from feeding us a blob of text.
  return text.length > 0 && text.length <= 48 ? text : null;
}

/**
 * Approximate `lastWatchedAt` of a section. Only used for list ordering and
 * pruning, so a day of tolerance is fine: today/yesterday are recognized in
 * the five UI locales, full dates are parsed by the engine when the locale
 * allows it, and anything else decays one day per section (sections are in
 * chronological order).
 */
function dayTimestamp(headerText: string | null, sectionIndex: number, now: number): number {
  if (headerText) {
    if (TODAY_WORDS.has(headerText)) return now;
    if (YESTERDAY_WORDS.has(headerText)) return now - DAY_MS;
    const parsed = Date.parse(headerText);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return now - (sectionIndex + 1) * DAY_MS;
}
