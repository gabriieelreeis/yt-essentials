/**
 * YT Essentials - content script (ISOLATED world).
 *
 * Responsibilities:
 *  1. Read settings from chrome.storage.local and forward them to the MAIN
 *     world script (src/entrypoints/main-world.content.ts), which controls
 *     the player.
 *  2. Detect YouTube SPA navigation (watch pages and shorts).
 *  3. Record watched videos into chrome.storage.local.
 *  4. Offer a "Next video" button over the page when the current video was
 *     already watched in a previous session (never on live streams).
 *  5. Draw the live-delay badge inside the player (data published by the MAIN
 *     world while the live-delay option is on).
 *  6. Offer a one-click import of the watch-history page (/feed/history) into
 *     the local watched list, covering videos watched before the extension.
 *
 * Quality/captions/live-delay control are intentionally NOT applied here:
 * page-defined methods of `#movie_player` are invisible from the isolated
 * world.
 */

import { defineContentScript } from 'wxt/utils/define-content-script';
import { ALREADY_WATCHED_PERCENT, DEFAULT_SETTINGS, STORAGE_KEYS } from '@/shared/constants';
import { t } from '@/shared/i18n';
import { logger } from '@/shared/logger';
import { MESSAGE_CHANNEL, readExtensionMessage, type AdvanceMessage, type SettingsMessage } from '@/shared/messages';
import {
  deepMerge,
  getSettings,
  getWatchedVideos,
  importWatchedVideos,
  upsertWatchedVideo
} from '@/shared/storage';
import type {
  DeepPartial,
  Settings,
  WatchedVideoImport,
  WatchedVideoInput,
  WatchedVideosMap
} from '@/shared/types';
import { parseVideoIdFromUrl } from '@/shared/utils';
import {
  collectHistoryItems,
  countHistoryCards,
  isHistoryPage,
  type HistoryItem
} from '@/shared/youtube-history';
import type { PlayerSettings } from '@/shared/youtube-player';
import '@/shared/skip-button.css';
import '@/shared/youtube-events';

const SAVE_INTERVAL_MS = 10000;
const TICK_INTERVAL_MS = 1000;
/** Delay before "skip automatically" advances, so the skip is visible rather than instant. */
const AUTO_SKIP_DELAY_MS = 1500;
/** Must match the id used by src/shared/skip-button.css. */
const SKIP_BUTTON_ID = 'yte-skip-button';
/** Stale-context notice (see showStaleNotice); ids must match skip-button.css. */
const STALE_NOTICE_ID = 'yte-stale-notice';
const STALE_NOTICE_MS = 15000;
/** Live-delay badge inside the player; id must match skip-button.css. */
const LIVE_STATUS_ID = 'yte-live-status';
/** Hide the live-delay badge when the MAIN world stops publishing for this long. */
const LIVE_STATUS_STALE_MS = 5000;
/** Watch-history import panel; id must match skip-button.css. */
const HISTORY_PANEL_ID = 'yte-history-import';
/** Wait for a lazily-loaded batch after scrolling before counting an idle step. */
const HISTORY_LOAD_TIMEOUT_MS = 3000;
/** Poll cadence while waiting for a batch to arrive. */
const HISTORY_POLL_MS = 250;
/** Fruitless loads in a row before the crawl gives up (end of the list). */
const HISTORY_IDLE_STEPS_MAX = 3;
/** Safety cap on collected videos (storage still prunes to watched.maxEntries). */
const HISTORY_IMPORT_MAX_ITEMS = 10000;

interface WatchSession {
  videoId: string;
  url: string;
  startedAt: number;
  duration: number;
  maxPosition: number;
  counted: boolean;
  pendingWrite: boolean;
  lastSaveAt: number;
  element: HTMLVideoElement | null;
  /**
   * Watched percentage from a previous session when the video counts as
   * "already watched" (>= ALREADY_WATCHED_PERCENT); null otherwise. Captured
   * when the session starts, before this session's own autosaves can change it.
   */
  previousPercent: number | null;
}

/** Latest live-delay data published by the MAIN world (see checkLiveDelay there). */
interface LiveStatusSnapshot {
  /** True latency against the live edge, in seconds (null when unmeasurable). */
  latencySeconds: number | null;
  /** Media downloaded ahead of the playhead, in seconds (null when unmeasurable). */
  bufferSeconds: number | null;
  catchingUp: boolean;
  catchUpRate: number;
  /** When the snapshot arrived (used to drop stale data). */
  at: number;
}

/**
 * Watch-history importer state (see updateHistoryPanel). One object for the
 * whole page; the generation guard keeps a cancelled crawl from resuming when
 * a new one is started while both are waiting on their own timers.
 */
interface HistoryImportState {
  status: 'idle' | 'running' | 'done';
  /** Video ids collected so far (dedupes across scroll batches). */
  found: Set<string>;
  /** Videos actually added to the stored watched list. */
  added: number;
  generation: number;
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',

  main(ctx) {
    /** Current watch session; null when not on a video page. */
    let session: WatchSession | null = null;
    /** Latest settings snapshot. */
    let settings: Settings | null = null;
    /** Watched-video map, kept in sync through chrome.storage.onChanged. */
    let watchedVideos: WatchedVideosMap | null = null;
    /** Floating "Next video" button injected over the player, when shown. */
    let skipButton: HTMLButtonElement | null = null;
    /**
     * Video id for which we already advanced (manually or automatically), so
     * auto-skip never fires twice for the same video — including when the user
     * navigates back to a video that had already been auto-skipped.
     */
    let advanceHandledFor: string | null = null;
    /** Pending auto-skip timer (see maybeAutoSkip). */
    let autoSkipTimerId: number | null = null;
    /** Last logged skip-state key, to keep the debug log to one line per change. */
    let lastSkipLogKey: string | null = null;
    /** True after telling the user once that the extension was reloaded. */
    let contextInvalidatedLogged = false;
    /** Latest live-delay snapshot from the MAIN world (badge data). */
    let liveStatus: LiveStatusSnapshot | null = null;
    /** Live-delay badge element inside the player, when shown. */
    let liveStatusBadge: HTMLDivElement | null = null;
    let lastHref = location.href;
    /** History-import panel and crawl state (see updateHistoryPanel). */
    let historyPanel: HTMLDivElement | null = null;
    let historyPanelSignature = '';
    let historyImportDismissed = false;
    const historyImport: HistoryImportState = {
      status: 'idle',
      found: new Set(),
      added: 0,
      generation: 0
    };

    void init();

    // -----------------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------------

    async function init(): Promise<void> {
      const [loadedSettings, loadedVideos] = await Promise.all([
        getSettings(),
        getWatchedVideos()
      ]);
      settings = loadedSettings;
      watchedVideos = loadedVideos;
      logger.setEnabled(settings.debug);
      logger.debug('content script loaded', settings);

      pushSettingsToMainWorld();

      chrome.storage.onChanged.addListener(onStorageChanged);
      window.addEventListener('message', onWindowMessage);
      window.addEventListener('pagehide', () => persistSession(session));
      document.addEventListener('yt-navigate-finish', handleNavigation);
      document.addEventListener('yt-page-data-updated', handleNavigation);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persistSession(session);
      });

      ctx.setInterval(tick, TICK_INTERVAL_MS);

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleNavigation, { once: true });
      } else {
        handleNavigation();
      }
    }

    // -----------------------------------------------------------------------
    // Settings plumbing
    // -----------------------------------------------------------------------

    const onStorageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      areaName
    ) => {
      if (areaName !== 'local') return;

      const settingsChange = changes[STORAGE_KEYS.settings];
      if (settingsChange) {
        settings = deepMerge(DEFAULT_SETTINGS, settingsChange.newValue as DeepPartial<Settings> | undefined);
        logger.setEnabled(settings.debug);
        logger.debug('settings updated', settings);
        pushSettingsToMainWorld();
      }

      const watchedChange = changes[STORAGE_KEYS.watchedVideos];
      if (watchedChange) {
        watchedVideos = (watchedChange.newValue as WatchedVideosMap | undefined) ?? {};
      }
    };

    function pushSettingsToMainWorld(): void {
      if (!settings) return;
      const playerSettings: PlayerSettings = {
        debug: settings.debug,
        quality: settings.quality,
        captions: settings.captions,
        liveDelay: settings.liveDelay
      };
      const message: SettingsMessage = {
        channel: MESSAGE_CHANNEL,
        type: 'settings',
        settings: playerSettings
      };
      window.postMessage(message, '*');
    }

    /** Handles main-world messages: settings requests and live-delay data. */
    function onWindowMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      const message = readExtensionMessage(event.data);
      if (!message) return;
      if (message.type === 'request-settings') {
        pushSettingsToMainWorld();
        return;
      }
      if (message.type === 'live-status') {
        liveStatus = {
          latencySeconds: message.latencySeconds,
          bufferSeconds: message.bufferSeconds,
          catchingUp: message.catchingUp,
          catchUpRate: message.catchUpRate,
          at: Date.now()
        };
      }
    }

    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------

    function handleNavigation(): void {
      updateHistoryPanel();
      const videoId = parseVideoIdFromUrl(location.href);
      if (!videoId) {
        persistSession(session);
        session = null;
        // Live badge data belongs to the previous page/video.
        liveStatus = null;
        return;
      }
      if (session && session.videoId === videoId) return;
      persistSession(session);
      liveStatus = null;
      startSession(videoId);
    }

    function startSession(videoId: string): void {
      // Read the previous record BEFORE this session's own autosaves land, so
      // "already watched" always reflects earlier visits.
      const previous = watchedVideos?.[videoId];
      const previousPercent =
        previous && (previous.percent ?? 0) >= ALREADY_WATCHED_PERCENT ? previous.percent : null;

      session = {
        videoId,
        url: location.href,
        startedAt: Date.now(),
        duration: 0,
        maxPosition: 0,
        counted: false,
        pendingWrite: false,
        lastSaveAt: 0,
        element: null,
        previousPercent
      };
      logger.debug('watch session started', videoId, { previousPercent });
      bindVideoElement(findVideoElement());
    }

    function findVideoElement(): HTMLVideoElement | null {
      const player =
        document.getElementById('movie_player') ?? document.getElementById('shorts-player');
      return (
        player?.querySelector('video') ??
        document.querySelector('video.html5-main-video') ??
        document.querySelector('video')
      );
    }

    function bindVideoElement(element: HTMLVideoElement | null): void {
      if (!session || !element || session.element === element) return;
      session.element = element;
      const onChange = (): void => trackProgress(element);
      element.addEventListener('timeupdate', onChange);
      element.addEventListener('durationchange', onChange);
      element.addEventListener('loadedmetadata', onChange);
      element.addEventListener('ended', onChange);
      trackProgress(element);
    }

    /**
     * Periodic SPA/player maintenance: catches navigation changes YouTube
     * does not announce (href polling fallback) and re-binds the session when
     * the <video> element appears or is replaced.
     */
    function tick(): void {
      if (location.href !== lastHref) {
        lastHref = location.href;
        handleNavigation();
      }
      if (session && session.element !== findVideoElement()) {
        bindVideoElement(findVideoElement());
      }
      const skip = skipState();
      updateSkipButton(skip);
      maybeAutoSkip(skip);
      updateLiveStatus();
      updateHistoryPanel();
    }

    // -----------------------------------------------------------------------
    // "Next video" button for already-watched videos
    // -----------------------------------------------------------------------

    interface SkipState {
      available: boolean;
      /** Human readable reason; shows up in the debug log. */
      reason: string;
    }

    /**
     * Whether the floating "Next video" button should be offered. Kept
     * intentionally permissive: finding a next video is YouTube's business
     * (advancing uses its own next button, with the player API as fallback), so
     * a wrong guess here would only hide a button that should be there.
     */
    function skipState(): SkipState {
      if (!settings?.skip.enabled) return { available: false, reason: 'disabled in settings' };
      // Shorts have a swipe-based navigation of their own; no button there.
      if (location.pathname.startsWith('/shorts/')) return { available: false, reason: 'shorts page' };
      if (!session) return { available: false, reason: 'not on a video page' };
      if (session.previousPercent === null) {
        return { available: false, reason: `not watched before (>= ${ALREADY_WATCHED_PERCENT}%)` };
      }
      if (isLivePlayback()) return { available: false, reason: 'live stream' };
      return { available: true, reason: 'already watched' };
    }

    /**
     * Creates/removes the button. Runs every tick, so a button removed by
     * anything (or by a player re-render, back when it lived inside the
     * player) is put back.
     */
    function updateSkipButton(skip: SkipState): void {
      logSkipState(skip);
      if (!skip.available) {
        if (skipButton) {
          skipButton.remove();
          skipButton = null;
        }
        return;
      }
      if (skipButton?.isConnected) return;

      skipButton = createSkipButton(session?.previousPercent ?? 0);
      // Page-level overlay: fixed to the viewport, on top of everything, and
      // independent from the player element (which YouTube re-creates on SPA
      // navigations).
      (document.body ?? document.documentElement).append(skipButton);
      logger.debug('skip button shown');
    }

    /** One debug line per state change, instead of one per second. */
    function logSkipState(skip: SkipState): void {
      const key = `${session?.videoId ?? '-'}|${skip.available}|${skip.reason}`;
      if (key === lastSkipLogKey) return;
      lastSkipLogKey = key;
      logger.debug('skip button state', {
        videoId: session?.videoId ?? null,
        previousPercent: session?.previousPercent ?? null,
        available: skip.available,
        reason: skip.reason,
        ...(logger.enabled ? { nativeNextButton: findNextButton() !== null } : {})
      });
    }

    /** Live streams are off-limits: they have no "next video" to advance to. */
    function isLivePlayback(): boolean {
      if (location.pathname.startsWith('/live/')) return true;
      if (document.querySelector('.html5-video-player.ytp-live')) return true;
      return session?.element?.duration === Infinity;
    }

    /**
     * YouTube's own next button. Clicking it reuses YouTube's navigation, so
     * playlists, autoplay queues and SPA transitions all behave natively.
     * Returns null when the button is not there or is visibly disabled.
     */
    function findNextButton(): HTMLElement | null {
      const button = document.querySelector<HTMLElement>('.ytp-next-button');
      if (!button) return null;
      if (button.classList.contains('ytp-button-disabled')) return null;
      if (button.getAttribute('aria-disabled') === 'true') return null;
      if (button.hasAttribute('disabled')) return null;
      return button;
    }

    function createSkipButton(previousPercent: number): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = SKIP_BUTTON_ID;
      button.textContent = t('skipButton');
      button.title = t('skipTooltip', [String(previousPercent)]);

      button.addEventListener('click', (event) => {
        // Never leak the click to YouTube's handlers (inside the player it
        // would toggle play/pause).
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        advanceToNextVideo();
      });

      return button;
    }

    /**
     * Advances to the next video: YouTube's own next button when available,
     * otherwise the player API through the MAIN world script. Marks the video
     * as handled so auto-skip never fires twice for it.
     */
    function advanceToNextVideo(): void {
      if (session) advanceHandledFor = session.videoId;
      skipButton?.remove();
      skipButton = null;

      const nativeButton = findNextButton();
      if (nativeButton) {
        logger.debug('advancing via YouTube next button', session?.videoId);
        nativeButton.click();
        return;
      }

      logger.debug('no next button in the DOM, asking the player to advance', session?.videoId);
      const message: AdvanceMessage = { channel: MESSAGE_CHANNEL, type: 'advance' };
      window.postMessage(message, '*');
    }

    /**
     * "Skip automatically": advances by itself a short delay after the button
     * appears (the delay keeps the skip visible instead of instant).
     * Fires at most once per video — `advanceHandledFor` also covers manual
     * clicks and revisits, so the extension never fights the user.
     */
    function maybeAutoSkip(skip: SkipState): void {
      if (!skip.available || !settings?.skip.autoSkip) return;
      const videoId = session?.videoId;
      if (!videoId || advanceHandledFor === videoId) return;
      if (autoSkipTimerId !== null) return;

      autoSkipTimerId = ctx.setTimeout(() => {
        autoSkipTimerId = null;
        // Re-check everything: the user may have changed settings, navigated
        // or clicked the button in the meantime.
        if (!settings?.skip.autoSkip) return;
        if (advanceHandledFor === videoId) return;
        if (session?.videoId !== videoId) return;
        if (!skipState().available) return;
        logger.debug('auto-skipping already watched video', videoId);
        advanceToNextVideo();
      }, AUTO_SKIP_DELAY_MS);
    }

    // -----------------------------------------------------------------------
    // Live-delay badge
    // -----------------------------------------------------------------------

    /**
     * Small badge drawn inside the player showing the live latency and the
     * buffer downloaded ahead of the playhead (plus the speed when the engine
     * is catching up). Data comes from the MAIN world (`live-status`
     * messages); when those stop arriving (option off, left the live, VOD) the
     * badge disappears. Living inside #movie_player makes it visible in
     * fullscreen too.
     */
    function updateLiveStatus(): void {
      const status = liveStatus;
      if (
        !status ||
        Date.now() - status.at >= LIVE_STATUS_STALE_MS ||
        !settings?.liveDelay.enabled
      ) {
        liveStatusBadge?.remove();
        liveStatusBadge = null;
        return;
      }

      const player =
        document.getElementById('movie_player') ?? document.getElementById('shorts-player');
      if (!player) return;

      if (!liveStatusBadge || !liveStatusBadge.isConnected) {
        liveStatusBadge = createLiveStatusBadge();
      }
      if (liveStatusBadge.parentElement !== player) player.append(liveStatusBadge);
      renderLiveStatus(liveStatusBadge, status);
    }

    function createLiveStatusBadge(): HTMLDivElement {
      const badge = document.createElement('div');
      badge.id = LIVE_STATUS_ID;
      // Informative overlay: must never steal a click from the player.
      badge.setAttribute('aria-hidden', 'true');
      return badge;
    }

    function renderLiveStatus(badge: HTMLDivElement, status: LiveStatusSnapshot): void {
      const latency = status.latencySeconds;
      const buffer = status.bufferSeconds;
      if (latency === null && buffer === null) {
        // Defensive: the MAIN world does not publish unmeasurable statuses.
        badge.remove();
        return;
      }
      let text: string;
      if (latency === null) {
        text = t('liveBadgeUnmeasured', [(buffer ?? 0).toFixed(1)]);
      } else if (buffer === null) {
        text = t('liveBadgeBehindNoBuffer', [latency.toFixed(1)]);
      } else {
        text = t('liveBadgeBehind', [latency.toFixed(1), buffer.toFixed(1)]);
      }
      if (status.catchingUp) text += ` · ${status.catchUpRate.toFixed(2)}x`;
      if (badge.textContent !== text) badge.textContent = text;
      badge.classList.toggle('yte-catching-up', status.catchingUp);
    }

    // -----------------------------------------------------------------------
    // Watch-history importer (youtube.com/feed/history)
    // -----------------------------------------------------------------------

    /**
     * Small panel offered on the watch-history page that imports the videos
     * listed there into the local watched list — including everything watched
     * before the extension was installed. The page only renders batches as it
     * scrolls, so while the import runs it drives the scroll itself and merges
     * each batch as it appears. Existing records are never touched (see
     * importWatchedVideos); imported dates and play counts are approximations.
     * Runs from the tick loop, so the panel survives re-renders.
     */
    function updateHistoryPanel(): void {
      const onHistory = isHistoryPage();
      if (!onHistory || historyImportDismissed || !settings?.watched.enabled) {
        removeHistoryPanel();
        if (!onHistory) {
          // Leaving the page cancels a running crawl and forgets the dismissal.
          historyImportDismissed = false;
          if (historyImport.status === 'running') historyImport.status = 'idle';
        }
        return;
      }
      if (!historyPanel || !historyPanel.isConnected) {
        historyPanel = document.createElement('div');
        historyPanel.id = HISTORY_PANEL_ID;
        (document.body ?? document.documentElement).append(historyPanel);
        historyPanelSignature = '';
      }
      renderHistoryPanel();
    }

    function removeHistoryPanel(): void {
      historyPanel?.remove();
      historyPanel = null;
      historyPanelSignature = '';
    }

    /**
     * Rebuilds the panel only when its visible content changed (signature
     * check): the tick loop calls this every second while the page is open.
     */
    function renderHistoryPanel(): void {
      const panel = historyPanel;
      if (!panel) return;
      const { status, found, added } = historyImport;
      const signature = `${status}|${found.size}|${added}`;
      if (signature === historyPanelSignature) return;
      historyPanelSignature = signature;

      const text = document.createElement('p');
      text.className = 'yte-history-import-text';
      const row = document.createElement('div');
      row.className = 'yte-history-import-row';

      if (status === 'running') {
        text.textContent = t('historyImportRunning', [String(found.size)]);
        row.append(createHistoryPanelButton(t('historyImportStop'), stopHistoryImport));
      } else if (status === 'done') {
        text.textContent = t('historyImportDone', [String(found.size), String(added)]);
        row.append(
          createHistoryPanelButton(t('historyImportDismiss'), dismissHistoryPanel, 'dismiss')
        );
      } else {
        text.textContent = t('historyImportHint');
        row.append(createHistoryPanelButton(t('historyImportButton'), startHistoryImport));
        row.append(
          createHistoryPanelButton(t('historyImportDismiss'), dismissHistoryPanel, 'dismiss')
        );
      }

      panel.replaceChildren(text, row);
    }

    function createHistoryPanelButton(
      label: string,
      onClick: () => void,
      variant?: string
    ): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (variant) button.classList.add(`yte-history-import-${variant}`);
      // The page's own click handlers must not see this.
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onClick();
      });
      return button;
    }

    function startHistoryImport(): void {
      if (historyImport.status === 'running') return;
      historyImport.generation += 1;
      historyImport.status = 'running';
      historyImport.found = new Set();
      historyImport.added = 0;
      renderHistoryPanel();
      void runHistoryImport(historyImport.generation);
    }

    function stopHistoryImport(): void {
      if (historyImport.status !== 'running') return;
      historyImport.status = 'done';
      renderHistoryPanel();
    }

    function dismissHistoryPanel(): void {
      historyImportDismissed = true;
      if (historyImport.status === 'running') historyImport.status = 'done';
      removeHistoryPanel();
    }

    /**
     * Drives the import: each round merges what is rendered, scrolls to the
     * bottom and waits for the next lazily-loaded batch. Gives up after a few
     * fruitless loads (end of the list) or when the user stops it.
     */
    async function runHistoryImport(generation: number): Promise<void> {
      let idleSteps = 0;
      await importHistoryBatch();
      while (isHistoryImportActive(generation)) {
        if (historyImport.found.size >= HISTORY_IMPORT_MAX_ITEMS) break;
        const before = countHistoryCards();
        window.scrollTo(0, document.documentElement.scrollHeight);
        const grew = await waitForHistoryGrowth(before, generation);
        if (!isHistoryImportActive(generation)) break;
        const collected = await importHistoryBatch();
        idleSteps = grew || collected ? 0 : idleSteps + 1;
        if (idleSteps >= HISTORY_IDLE_STEPS_MAX) break;
      }
      if (isHistoryImportActive(generation)) {
        historyImport.status = 'done';
        renderHistoryPanel();
        logger.debug('history import finished', {
          found: historyImport.found.size,
          added: historyImport.added
        });
      }
    }

    function isHistoryImportActive(generation: number): boolean {
      return historyImport.status === 'running' && historyImport.generation === generation;
    }

    /** Collects the cards currently rendered and merges the new ones. */
    async function importHistoryBatch(): Promise<boolean> {
      const fresh: HistoryItem[] = [];
      for (const item of collectHistoryItems()) {
        if (historyImport.found.has(item.id)) continue;
        historyImport.found.add(item.id);
        fresh.push(item);
      }
      if (fresh.length === 0) return false;
      renderHistoryPanel();

      try {
        const added = await importWatchedVideos(fresh.map(toImportRecord), {
          maxEntries: settings?.watched.maxEntries
        });
        historyImport.added += added;
        logger.debug('history import batch merged', {
          batch: fresh.length,
          found: historyImport.found.size,
          added: historyImport.added
        });
      } catch (error) {
        if (isExtensionAlive()) logger.warn('could not import the watch history', error);
        historyImport.status = 'done';
      }
      renderHistoryPanel();
      return true;
    }

    /** Maps a scraped card onto the storage import shape. */
    function toImportRecord(item: HistoryItem): WatchedVideoImport {
      return {
        id: item.id,
        title: item.title,
        channel: item.channel,
        duration: item.durationSeconds,
        percent: item.percent,
        firstWatchedAt: item.watchedAt,
        lastWatchedAt: item.watchedAt,
        playCount: 1
      };
    }

    /**
     * Waits for the next lazily-loaded batch (the card count grows). False
     * when nothing new appears within the timeout, or when the crawl stopped.
     */
    async function waitForHistoryGrowth(previousCount: number, generation: number): Promise<boolean> {
      const deadline = Date.now() + HISTORY_LOAD_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(HISTORY_POLL_MS);
        if (!isHistoryImportActive(generation)) return false;
        if (countHistoryCards() > previousCount) return true;
      }
      return countHistoryCards() > previousCount;
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => {
        ctx.setTimeout(() => resolve(), ms);
      });
    }

    // -----------------------------------------------------------------------
    // Watched-video recording
    // -----------------------------------------------------------------------

    function trackProgress(element: HTMLVideoElement): void {
      if (!session) return;
      const time = element.currentTime;
      const duration = element.duration;
      // Live streams report Infinity/NaN duration; ignore those values.
      if (Number.isFinite(time) && time > session.maxPosition) session.maxPosition = time;
      if (Number.isFinite(duration) && duration > 0) session.duration = duration;
      if (Date.now() - session.lastSaveAt >= SAVE_INTERVAL_MS) persistSession(session);
    }

    /**
     * False once the extension was reloaded/updated while this tab stayed open
     * ("Extension context invalidated"): every `chrome.*` call is dead until
     * the page is reloaded, so storage work must stop instead of failing every
     * 10s. `ctx.isValid` also handles WXT's own cleanup (timers, ctx listeners).
     */
    function isExtensionAlive(): boolean {
      if (ctx.isValid) return true;
      if (!contextInvalidatedLogged) {
        contextInvalidatedLogged = true;
        logger.info('extension was reloaded or updated: reload this YouTube tab to keep recording videos');
        showStaleNotice();
      }
      return false;
    }

    /**
     * Visible warning that this tab is running a stale content script (the
     * extension was reloaded/updated with the tab open). Without it the
     * failure is silent: WXT stops the timers and the skip button simply never
     * appears. Auto-hides; the fix is always to reload the page.
     */
    function showStaleNotice(): void {
      if (document.getElementById(STALE_NOTICE_ID)) return;
      const notice = document.createElement('div');
      notice.id = STALE_NOTICE_ID;
      notice.textContent = t('staleNotice');
      (document.body ?? document.documentElement).append(notice);
      // Plain window.setTimeout: ctx timers never fire once invalidated.
      window.setTimeout(() => notice.remove(), STALE_NOTICE_MS);
    }

    /**
     * Writes the current session state to storage. Called periodically while
     * watching (so a closed tab still keeps progress) and on navigation/exit.
     */
    function persistSession(target: WatchSession | null): void {
      if (!target || !settings || target.pendingWrite) return;
      if (!settings.watched.enabled) return;
      if (!isExtensionAlive()) return;

      const watchedSeconds = Math.round(target.maxPosition);
      if (watchedSeconds < settings.watched.minSeconds) return;

      target.lastSaveAt = Date.now();
      target.pendingWrite = true;

      const record: WatchedVideoInput = {
        id: target.videoId,
        url: target.url,
        title: getVideoTitle(),
        channel: getChannelName(),
        duration: Math.round(target.duration),
        watchedSeconds
      };

      upsertWatchedVideo(record, {
        incrementPlayCount: !target.counted,
        maxEntries: settings.watched.maxEntries
      })
        .then(() => {
          target.counted = true;
          logger.debug('watched video saved', record);
        })
        .catch((error: unknown) => {
          // Invalidation between the read and the write of the upsert: the
          // extension is gone, nothing to warn about.
          if (!isExtensionAlive()) return;
          logger.warn('could not save watched video', error);
        })
        .finally(() => {
          target.pendingWrite = false;
        });
    }

    /**
     * Video title. `<meta name="title">` is the most stable source: it is a
     * native page element (no YouTube custom selectors involved) and it is
     * updated on SPA navigation.
     */
    function getVideoTitle(): string {
      const meta =
        document.querySelector<HTMLMetaElement>('meta[name="title"]') ??
        document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
      if (meta?.content.trim()) return meta.content.trim();

      const heading = document.querySelector(
        'ytd-watch-metadata h1 yt-formatted-string, ytd-watch-metadata h1, #title h1 yt-formatted-string'
      );
      if (heading?.textContent?.trim()) return heading.textContent.trim();

      return document.title ? document.title.replace(/\s*-\s*YouTube$/, '') : '';
    }

    function getChannelName(): string {
      const element = document.querySelector(
        'ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a, #channel-name a, ytd-reel-player-header-renderer a'
      );
      return element?.textContent?.trim() ?? '';
    }
  }
});
