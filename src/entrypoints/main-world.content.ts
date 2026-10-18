/**
 * YT Essentials - content script (MAIN world).
 *
 * Runs inside the page's own JavaScript world, where the YouTube player API
 * (`#movie_player`) is reachable. Isolated-world content scripts cannot see
 * page-defined methods such as getAvailableQualityLevels(),
 * setPlaybackQualityRange() or setOption(), which is exactly why this file
 * exists.
 *
 * Communication with src/entrypoints/content.ts happens via window.postMessage:
 *   content.ts -> here : { channel: 'yt-essentials', type: 'settings', settings }
 *   content.ts -> here : { channel: 'yt-essentials', type: 'request-settings' }
 *   content.ts -> here : { channel: 'yt-essentials', type: 'advance' }
 *
 * Rules for this file:
 *  - never use chrome.* APIs (not available in the MAIN world);
 *  - never attach anything to `window` (the page can see it);
 *  - keep every player call defensive (try/catch): the player API is
 *    internal and changes between YouTube releases.
 */

import { defineContentScript } from 'wxt/utils/define-content-script';
import { MESSAGE_CHANNEL, readExtensionMessage } from '@/shared/messages';
import {
  getPlayerElement,
  isSameTrack,
  pickCaptionTrack,
  pickQuality,
  type CaptionTrackInfo,
  type PlayerSettings
} from '@/shared/youtube-player';
import '@/shared/youtube-events';

const RETRY_INTERVAL_MS = 500;
const RETRY_MAX_MS = 20000;

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    let settings: PlayerSettings | null = null;
    let pendingQuality = false;
    let pendingCaptions = false;
    let retryTimer: number | null = null;
    let retryDeadline = 0;

    window.addEventListener('message', onWindowMessage);
    document.addEventListener('yt-navigate-finish', onNavigation);
    document.addEventListener('yt-page-data-updated', onNavigation);
    window.addEventListener('load', onNavigation);
    // Video events do not bubble, so they are observed in the capture phase.
    document.addEventListener('loadstart', onVideoEvent, true);
    document.addEventListener('playing', onVideoEvent, true);

    requestSettings();

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    function requestSettings(): void {
      window.postMessage({ channel: MESSAGE_CHANNEL, type: 'request-settings' }, '*');
    }

    function onWindowMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      const message = readExtensionMessage(event.data);
      if (!message) return;

      if (message.type === 'advance') {
        advanceToNextVideo();
        return;
      }
      if (message.type !== 'settings') return;

      settings = message.settings;
      debug('settings received', settings);
      pendingQuality = !!settings?.quality?.enabled;
      pendingCaptions = !!settings?.captions?.enabled;
      startRetryLoop();
    }

    /**
     * Fallback used when the isolated world cannot find YouTube's native next
     * button: the player itself knows how to advance.
     */
    function advanceToNextVideo(): void {
      const player = getPlayerElement();
      if (!player || typeof player.nextVideo !== 'function') {
        debug('player.nextVideo() unavailable');
        return;
      }
      try {
        player.nextVideo();
        debug('player.nextVideo() called');
      } catch (error) {
        debug('nextVideo failed', error);
      }
    }

    function onNavigation(): void {
      debug('navigation', location.href);
      if (settings?.quality?.enabled) pendingQuality = true;
      if (settings?.captions?.enabled) pendingCaptions = true;
      startRetryLoop();
    }

    function onVideoEvent(event: Event): void {
      if (!(event.target instanceof HTMLVideoElement)) return;
      debug('video event', event.type);
      if (settings?.quality?.enabled) pendingQuality = true;
      if (settings?.captions?.enabled) pendingCaptions = true;
      startRetryLoop();
    }

    function debug(...args: unknown[]): void {
      if (settings?.debug) console.debug('[YT Essentials:main]', ...args);
    }

    // -----------------------------------------------------------------------
    // Retry loop
    // -----------------------------------------------------------------------

    /**
     * Applies pending changes every RETRY_INTERVAL_MS until both succeed or
     * the deadline is reached. A retry is needed because the player is not
     * ready when the content script runs and because pre-roll ads reset its
     * state.
     */
    function startRetryLoop(): void {
      // Extending the deadline also covers the case where the loop is already
      // running but was about to give up when a new event arrived.
      retryDeadline = Date.now() + RETRY_MAX_MS;
      if (retryTimer !== null) return;

      const tick = (): void => {
        if (pendingQuality && applyQuality()) pendingQuality = false;
        if (pendingCaptions && applyCaptions()) pendingCaptions = false;

        const done = !pendingQuality && !pendingCaptions;
        if (done || Date.now() > retryDeadline) {
          if (!done) debug('giving up on pending player changes', { pendingQuality, pendingCaptions });
          if (retryTimer !== null) window.clearInterval(retryTimer);
          retryTimer = null;
        }
      };

      retryTimer = window.setInterval(tick, RETRY_INTERVAL_MS);
      tick();
    }

    // -----------------------------------------------------------------------
    // Quality
    // -----------------------------------------------------------------------

    /** @returns true when there is nothing left to do. */
    function applyQuality(): boolean {
      const player = getPlayerElement();
      if (!player || typeof player.setPlaybackQualityRange !== 'function') return false;

      const requested = settings?.quality?.value || 'auto';
      if (requested === 'auto') {
        // Best effort: hand quality control back to YouTube.
        try {
          player.setPlaybackQualityRange('auto', 'auto');
        } catch {
          /* ignore */
        }
        return true;
      }

      const available = (
        typeof player.getAvailableQualityLevels === 'function'
          ? player.getAvailableQualityLevels()
          : []
      ).filter(Boolean);
      if (available.length === 0) return false;

      const target = pickQuality(available, requested);
      if (!target) return false;

      if (typeof player.getPlaybackQuality === 'function' && player.getPlaybackQuality() === target) {
        return true;
      }

      try {
        player.setPlaybackQualityRange(target, target);
        if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(target);
      } catch (error) {
        debug('setPlaybackQualityRange failed', error);
        return false;
      }

      debug('quality applying', { requested, target, available });

      // Keep retrying until the player reports the target quality (switching
      // takes a moment, and YouTube can silently ignore the first call).
      return typeof player.getPlaybackQuality === 'function'
        ? player.getPlaybackQuality() === target
        : true;
    }

    // -----------------------------------------------------------------------
    // Captions
    // -----------------------------------------------------------------------

    /** @returns true when there is nothing left to do. */
    function applyCaptions(): boolean {
      const player = getPlayerElement();
      if (!player || typeof player.setOption !== 'function') return false;

      const language = settings?.captions?.language;
      if (!language) return true;

      try {
        player.loadModule?.('captions');
      } catch {
        /* module loading is best effort */
      }

      let tracklist: unknown;
      try {
        tracklist = player.getOption?.('captions', 'tracklist');
      } catch {
        return false;
      }
      if (!Array.isArray(tracklist) || tracklist.length === 0) return false;

      const choice = pickCaptionTrack(tracklist as CaptionTrackInfo[], language);
      if (!choice) {
        debug('no caption track available for', language);
        return true; // Nothing to do for this video; stop retrying.
      }

      try {
        const current = player.getOption?.('captions', 'track') as CaptionTrackInfo | null | undefined;
        if (isSameTrack(current, choice.track)) return true;
        player.setOption('captions', 'track', choice.track);
        if (choice.reload) player.setOption('captions', 'reload', true);
      } catch (error) {
        debug('setOption(captions) failed', error);
        return false;
      }

      let current: CaptionTrackInfo | null | undefined;
      try {
        current = player.getOption?.('captions', 'track') as CaptionTrackInfo | null | undefined;
      } catch {
        /* ignore */
      }
      debug('captions applying', { language, track: choice.track, current });
      return isSameTrack(current, choice.track);
    }
  }
});
