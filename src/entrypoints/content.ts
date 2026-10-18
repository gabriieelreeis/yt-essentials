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
 *
 * Quality/captions are intentionally NOT applied here: page-defined methods
 * of `#movie_player` are invisible from the isolated world.
 */

import { defineContentScript } from 'wxt/utils/define-content-script';
import { ALREADY_WATCHED_PERCENT, DEFAULT_SETTINGS, STORAGE_KEYS } from '@/shared/constants';
import { logger } from '@/shared/logger';
import { MESSAGE_CHANNEL, readExtensionMessage, type AdvanceMessage, type SettingsMessage } from '@/shared/messages';
import { deepMerge, getSettings, getWatchedVideos, upsertWatchedVideo } from '@/shared/storage';
import type { DeepPartial, Settings, WatchedVideoInput, WatchedVideosMap } from '@/shared/types';
import { parseVideoIdFromUrl } from '@/shared/utils';
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
    let lastHref = location.href;

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
        captions: settings.captions
      };
      const message: SettingsMessage = {
        channel: MESSAGE_CHANNEL,
        type: 'settings',
        settings: playerSettings
      };
      window.postMessage(message, '*');
    }

    /** Answers the main-world script when it asks for the current settings. */
    function onWindowMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      const message = readExtensionMessage(event.data);
      if (message?.type === 'request-settings') pushSettingsToMainWorld();
    }

    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------

    function handleNavigation(): void {
      const videoId = parseVideoIdFromUrl(location.href);
      if (!videoId) {
        persistSession(session);
        session = null;
        return;
      }
      if (session && session.videoId === videoId) return;
      persistSession(session);
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
      button.textContent = 'Next video';
      button.title = `You already watched this video (${previousPercent}%)`;

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
      notice.textContent = 'YT Essentials was updated - reload this page to keep it working.';
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
