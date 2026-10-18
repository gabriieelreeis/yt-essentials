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
 *   here -> content.ts : { channel: 'yt-essentials', type: 'live-status', ... }
 *
 * Rules for this file:
 *  - never use chrome.* APIs (not available in the MAIN world);
 *  - never attach anything to `window` (the page can see it);
 *  - keep every player call defensive (try/catch): the player API is
 *    internal and changes between YouTube releases.
 */

import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  LIVE_CATCH_UP_RATE,
  LIVE_DELAY_CHECK_INTERVAL_MS,
  LIVE_DELAY_OPTIONS,
  LIVE_DELAY_STOP_MARGIN_S,
  LIVE_DELAY_TOLERANCE_S
} from '@/shared/constants';
import {
  MESSAGE_CHANNEL,
  readExtensionMessage,
  type LiveStatusMessage
} from '@/shared/messages';
import {
  getPlayerElement,
  isSameTrack,
  liveEdgeDelay,
  pickCaptionTrack,
  pickQuality,
  type CaptionTrackInfo,
  type PlayerProgressState,
  type PlayerSettings,
  type YouTubePlayerElement
} from '@/shared/youtube-player';
import '@/shared/youtube-events';

const RETRY_INTERVAL_MS = 500;
const RETRY_MAX_MS = 20000;
/** `getPlayerState()` value while the video is actually playing. */
const PLAYER_STATE_PLAYING = 1;

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
    /** Last live-delay diagnostic shown, so notices stay at one per video+reason. */
    let lastLiveNoticeKey: string | null = null;
    /** Live catch-up state: whether the rate was changed and what to restore. */
    let liveCatchUpApplied = false;
    let liveCatchUpElement: YouTubePlayerElement | null = null;
    let liveRateBefore: number | null = null;

    window.addEventListener('message', onWindowMessage);
    document.addEventListener('yt-navigate-finish', onNavigation);
    document.addEventListener('yt-page-data-updated', onNavigation);
    window.addEventListener('load', onNavigation);
    // Video events do not bubble, so they are observed in the capture phase.
    document.addEventListener('loadstart', onVideoEvent, true);
    document.addEventListener('playing', onVideoEvent, true);

    requestSettings();

    // Live-delay policing has its own cadence: it must keep running across SPA
    // navigations and is a no-op unless enabled and a live stream is playing.
    window.setInterval(checkLiveDelay, LIVE_DELAY_CHECK_INTERVAL_MS);

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

    // -----------------------------------------------------------------------
    // Live delay
    // -----------------------------------------------------------------------

    /**
     * Keeps live playback close to the live edge. YouTube starts viewers near
     * their achievable edge, but the delay grows (stalls, pausing, DVR
     * wandering); when it exceeds the buffer chosen in the settings, playback
     * is accelerated (LIVE_CATCH_UP_RATE) until the delay is back inside the
     * buffer, then the previous speed is restored. VODs, paused playback and
     * ads are never touched. Every check also publishes `live-status` so the
     * isolated world can draw the badge inside the player.
     */
    function checkLiveDelay(): void {
      const player = getPlayerElement();
      if (!player) return;
      if (liveCatchUpApplied && liveCatchUpElement !== player) {
        // The player element was recreated (navigation) while catching up:
        // the new one starts at its own rate, nothing to restore.
        liveCatchUpApplied = false;
        liveCatchUpElement = null;
        liveRateBefore = null;
      }

      const config = settings?.liveDelay;
      const enabled = !!config?.enabled;
      const option = config
        ? LIVE_DELAY_OPTIONS.find((item) => item.value === config.buffer)
        : undefined;

      let progress: PlayerProgressState | undefined;
      try {
        progress = player.getProgressState?.();
      } catch {
        progress = undefined;
      }

      const isLive = progress?.isLive === true || player.getVideoData?.()?.isLive === true;
      const delay = liveEdgeDelay(progress);
      const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
      const playing = state === null || state === PLAYER_STATE_PLAYING;
      const adShowing = player.classList.contains('ad-showing');

      // Badge data for the isolated world; it hides the badge when these stop
      // arriving (option off, left the live, VOD).
      if (enabled && option && isLive && !adShowing) {
        const status: LiveStatusMessage = {
          channel: MESSAGE_CHANNEL,
          type: 'live-status',
          bufferSeconds: option.seconds,
          delaySeconds: delay,
          catchingUp: liveCatchUpApplied,
          catchUpRate: LIVE_CATCH_UP_RATE
        };
        window.postMessage(status, '*');
      }

      const actionable = enabled && !!option && isLive && delay !== null && playing && !adShowing;
      if (!actionable || !option || delay === null) {
        if (liveCatchUpApplied) stopLiveCatchUp(player, null);
        else if (enabled && isLive && option && delay === null) {
          logLiveDelayNotice('cannot measure the live delay', { buffer: option.value });
        }
        return;
      }

      const threshold =
        option.seconds + (liveCatchUpApplied ? LIVE_DELAY_STOP_MARGIN_S : LIVE_DELAY_TOLERANCE_S);
      if (delay > threshold) {
        if (!liveCatchUpApplied) startLiveCatchUp(player, delay, option.seconds);
      } else if (liveCatchUpApplied) {
        stopLiveCatchUp(player, delay);
      }
    }

    /** Accelerates playback until `checkLiveDelay` decides the target is reached. */
    function startLiveCatchUp(
      player: YouTubePlayerElement,
      delaySeconds: number,
      bufferSeconds: number
    ): void {
      const current = readPlaybackRate(player);
      liveRateBefore = current ?? 1;
      liveCatchUpElement = player;
      liveCatchUpApplied = true;

      if (current !== LIVE_CATCH_UP_RATE && !writePlaybackRate(player, LIVE_CATCH_UP_RATE)) {
        liveCatchUpApplied = false;
        liveCatchUpElement = null;
        debug('live delay: playback rate API unavailable');
        return;
      }
      debug('live delay: catching up', {
        delaySeconds: Number(delaySeconds.toFixed(1)),
        bufferSeconds,
        rate: LIVE_CATCH_UP_RATE
      });
    }

    /** Restores the previous speed once the delay is back inside the buffer. */
    function stopLiveCatchUp(player: YouTubePlayerElement, delaySeconds: number | null): void {
      const current = readPlaybackRate(player);
      const target = liveRateBefore ?? 1;
      liveCatchUpApplied = false;
      liveCatchUpElement = null;
      liveRateBefore = null;

      // A rate different from ours means the user took over; leave it alone.
      if (current !== null && current !== LIVE_CATCH_UP_RATE) return;
      if (current !== target) writePlaybackRate(player, target);
      debug('live delay: catch-up finished', {
        delaySeconds: delaySeconds === null ? null : Number(delaySeconds.toFixed(1)),
        restoredRate: target
      });
    }

    function readPlaybackRate(player: YouTubePlayerElement): number | null {
      try {
        const rate = player.getPlaybackRate?.();
        if (typeof rate === 'number' && Number.isFinite(rate)) return rate;
      } catch {
        /* fall through to the raw video element */
      }
      try {
        const video = player.querySelector('video');
        if (!video) return null;
        const rate = video.playbackRate;
        return Number.isFinite(rate) ? rate : null;
      } catch {
        return null;
      }
    }

    /** Sets the rate through the player API, falling back to the <video> element. */
    function writePlaybackRate(player: YouTubePlayerElement, rate: number): boolean {
      try {
        if (typeof player.setPlaybackRate === 'function') {
          player.setPlaybackRate(rate);
          return true;
        }
      } catch {
        /* fall through to the raw video element */
      }
      try {
        const video = player.querySelector('video');
        if (!video) return false;
        video.playbackRate = rate;
        return true;
      } catch {
        return false;
      }
    }

    /** One debug line per video+reason, so a broken live does not spam the console. */
    function logLiveDelayNotice(reason: string, extra: Record<string, unknown>): void {
      const videoId = getPlayerElement()?.getVideoData?.()?.video_id ?? null;
      const key = `${videoId ?? location.pathname}|${reason}`;
      if (key === lastLiveNoticeKey) return;
      lastLiveNoticeKey = key;
      debug(`live delay: ${reason}`, { videoId, ...extra });
    }
  }
});
