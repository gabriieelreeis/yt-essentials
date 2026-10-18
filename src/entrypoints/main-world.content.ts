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
  LIVE_AUTO_COOLDOWN_TICKS,
  LIVE_AUTO_CREEP_S_PER_TICK,
  LIVE_AUTO_TARGET_MAX_S,
  LIVE_AUTO_TARGET_MIN_S,
  LIVE_AUTO_TARGET_START_S,
  LIVE_BRAKE_DRIFT_CEIL_S,
  LIVE_BRAKE_DRIFT_SPAN_S,
  LIVE_BRAKE_FLOOR_RATE,
  LIVE_BRAKE_GAIN,
  LIVE_BRAKE_START_S,
  LIVE_BUFFER_BACKOFF_S,
  LIVE_BUFFER_RAMP_S,
  LIVE_BUFFER_RESUME_S,
  LIVE_BUFFER_STALL_FLOOR_S,
  LIVE_CATCH_UP_RATE,
  LIVE_DELAY_IDLE_INTERVAL_MS,
  LIVE_DELAY_PUBLISH_MS,
  LIVE_DELAY_TICK_MIN_MS,
  LIVE_DRAIN_BRAKE_STEP_S,
  LIVE_ENGAGE_BAND_S,
  LIVE_LATENCY_FULL_S,
  LIVE_MIN_LATENCY_S,
  LIVE_NEAR_STALL_S,
  LIVE_RATE_STEP,
  LIVE_SKIP_REARM_S,
  LIVE_SKIP_TO_LIVE_S
} from '@/shared/constants';
import {
  MESSAGE_CHANNEL,
  readExtensionMessage,
  type LiveStatusMessage
} from '@/shared/messages';
import {
  getPlayerElement,
  isSameTrack,
  pickCaptionTrack,
  pickQuality,
  readLiveStats,
  seekToLiveHead,
  type CaptionTrackInfo,
  type LivePlaybackStats,
  type PlayerProgressState,
  type PlayerSettings,
  type PlayerVideoData,
  type YouTubePlayerElement
} from '@/shared/youtube-player';
import '@/shared/youtube-events';

const RETRY_INTERVAL_MS = 500;
const RETRY_MAX_MS = 20000;
/** `getPlayerState()` value while the video is actually playing. */
const PLAYER_STATE_PLAYING = 1;

/**
 * Live catch-up control state. One instance lives for the whole content
 * script; `resetLiveControl` clears the measurements whenever the video
 * changes so one stream's averages never steer the next one.
 */
interface LiveEngineState {
  /** Smoothed buffer health (null until the first tick). */
  bufferEma: number | null;
  /** Previous raw buffer health, for the trend. */
  lastBuffer: number | null;
  /** Smoothed buffer trend per tick (negative while draining). */
  drainEma: number;
  /** Catch-up hysteresis: true while surplus buffer may be spent. */
  engaged: boolean;
  /** True after a dip below the backoff line until the buffer recovers. */
  backoff: boolean;
  /** Adaptive cushion target, in seconds (see adjustAdaptiveTarget). */
  target: number;
  /** Ticks left before the cushion may creep back down. */
  targetCooldown: number;
  /** True after the jump-to-live backstop fired, until the latency recovers. */
  skipped: boolean;
  /** Rate we last wrote or adopted (1 = normal). */
  appliedRate: number;
  /** True when the user set a speed manually; the engine must not fight it. */
  rateYielded: boolean;
}

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
    /** Video the live engine is attached to; a change resets the control state. */
    let liveVideoKey: string | null = null;
    /** Live catch-up control state (see checkLiveDelay). */
    const liveEngine = createLiveEngine();
    /** When the last live-status message was sent (publish throttle). */
    let liveStatusSentAt = 0;
    /** Last engine tick across drivers (shared throttle). */
    let lastLiveTickAt = 0;

    window.addEventListener('message', onWindowMessage);
    document.addEventListener('yt-navigate-finish', onNavigation);
    document.addEventListener('yt-page-data-updated', onNavigation);
    window.addEventListener('load', onNavigation);
    // Video events do not bubble, so they are observed in the capture phase.
    document.addEventListener('loadstart', onVideoEvent, true);
    document.addEventListener('playing', onVideoEvent, true);
    // 'timeupdate' keeps the live-delay loop alive while the media advances:
    // timers are throttled hard in hidden tabs, media events are not.
    document.addEventListener('timeupdate', onLiveTick, true);
    document.addEventListener('visibilitychange', onVisibilityChange);

    requestSettings();

    // Live-delay policing has its own cadence: it must keep running across SPA
    // navigations and is a no-op unless enabled and a live stream is playing.
    // The interval covers paused/loading states; while playing, the shared
    // throttle is fed by 'timeupdate' events (~4 ticks/s).
    window.setInterval(onLiveTick, LIVE_DELAY_IDLE_INTERVAL_MS);

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

    /** Coming back from a hidden tab: check right away, with fresh data. */
    function onVisibilityChange(): void {
      if (document.visibilityState !== 'visible') return;
      lastLiveTickAt = 0;
      onLiveTick();
    }

    /**
     * Shared throttle for the live-delay drivers: 'timeupdate' events while
     * the media advances (~4/s; media events are not throttled in hidden tabs
     * like timers are) and the fallback interval for paused states. The tick
     * spacing matches the controller EMAs' tuning.
     */
    function onLiveTick(): void {
      const now = Date.now();
      if (now - lastLiveTickAt < LIVE_DELAY_TICK_MIN_MS) return;
      lastLiveTickAt = now;
      checkLiveDelay();
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
     * Keeps live playback close to the live edge with a buffer-regulation
     * control loop (the approach the ZeroDelay extension validated on real
     * streams):
     *  - the control signal is `buffer_health_seconds` — the media already
     *    downloaded ahead of the playhead, the part playback speed can spend.
     *    `seekableEnd − current` stays near zero even 20s+ behind live, so it
     *    is never used to steer;
     *  - playback speeds up proportionally to latency demand × surplus buffer
     *    above an adaptive cushion (up to LIVE_CATCH_UP_RATE), rests at 1x —
     *    which holds the latency — and dips to 0.95x to rebuild a thin cushion;
     *  - a jump-to-live backstop (LIVE_SKIP_TO_LIVE_S) covers huge backlogs
     *    (a long pause) that acceleration could not close.
     * VODs, paused playback and ads are never touched, and a manual speed
     * change from the user is respected until they return to 1x. Every tick
     * also publishes `live-status` (throttled) so the isolated world can draw
     * the badge inside the player.
     */
    function checkLiveDelay(): void {
      const player = getPlayerElement();
      if (!player) return;

      const videoData = readVideoData(player);
      const videoKey = videoData?.video_id ?? null;
      if (videoKey !== liveVideoKey) {
        liveVideoKey = videoKey;
        resetLiveControl(liveEngine);
        debug('live delay: control state reset', { videoId: videoKey });
      }

      const enabled = settings?.liveDelay?.enabled === true;
      const isLive = videoData?.isLive === true || readProgress(player)?.isLive === true;
      const adShowing = player.classList.contains('ad-showing');
      const stats = enabled && isLive && !adShowing ? readLiveStats(player) : null;

      // Badge data for the isolated world; it hides the badge when these stop
      // arriving (option off, left the live, VOD).
      if (stats) publishLiveStatus(stats);

      const state = readPlayerState(player);
      const playing = state === null || state === PLAYER_STATE_PLAYING;
      const actionable = enabled && isLive && playing && !adShowing && !liveEngine.rateYielded;
      if (!actionable) {
        adoptEchoedRate(player);
        releaseLiveRate(player);
        return;
      }
      if (!stats || stats.latencySeconds === null || stats.bufferSeconds === null) {
        releaseLiveRate(player);
        if (stats && stats.latencySeconds === null) {
          logLiveDelayNotice('cannot measure the live latency', {
            bufferSeconds: stats.bufferSeconds
          });
        }
        return;
      }

      const latency = stats.latencySeconds;
      const buffer = stats.bufferSeconds;
      maybeSkipToLive(player, latency);

      const rateBefore = liveEngine.appliedRate;
      applyLiveRate(player, liveCatchUpRate(latency, buffer));
      logRateTransition(rateBefore, latency, buffer);
    }

    /** Throttled `live-status` message; the isolated world draws the badge. */
    function publishLiveStatus(stats: LivePlaybackStats): void {
      if (stats.latencySeconds === null && stats.bufferSeconds === null) return;
      const now = Date.now();
      if (now - liveStatusSentAt < LIVE_DELAY_PUBLISH_MS) return;
      liveStatusSentAt = now;
      const status: LiveStatusMessage = {
        channel: MESSAGE_CHANNEL,
        type: 'live-status',
        latencySeconds: stats.latencySeconds,
        bufferSeconds: stats.bufferSeconds,
        catchingUp: !liveEngine.rateYielded && liveEngine.appliedRate > 1.001,
        catchUpRate: liveEngine.appliedRate
      };
      window.postMessage(status, '*');
    }

    /**
     * Buffer-regulation loop (mirrors the reference controller): returns the
     * playback rate to hold this tick — 1 at rest, up to LIVE_CATCH_UP_RATE
     * while spending surplus buffer, down to LIVE_BRAKE_FLOOR_RATE while
     * rebuilding a thin one.
     */
    function liveCatchUpRate(latency: number, health: number): number {
      const engine = liveEngine;
      engine.bufferEma =
        engine.bufferEma === null ? health : engine.bufferEma * 0.9 + health * 0.1;
      if (engine.lastBuffer !== null) {
        engine.drainEma = engine.drainEma * 0.8 + (health - engine.lastBuffer) * 0.2;
      }
      engine.lastBuffer = health;

      // The cushion adapts to the connection (the loop the reference calls
      // "automatic"): a near-stall raises it by one second; calm streaming
      // creeps it back down. Runs first so the target keeps adapting even
      // while the early rests below return.
      const target = adjustAdaptiveTarget(health);

      if (latency < LIVE_MIN_LATENCY_S) return restOrBrake(latency);
      if (health < LIVE_BUFFER_STALL_FLOOR_S) return restOrBrake(latency);

      // Instantaneous backoff: a raw dip cuts acceleration now and it stays
      // cut until the buffer recovers (no EMA, no taper) — this protects the
      // descent phase, where a trough is how late segments become stalls.
      if (health <= LIVE_BUFFER_BACKOFF_S) engine.backoff = true;
      else if (health >= LIVE_BUFFER_RESUME_S) engine.backoff = false;
      if (engine.backoff) return restOrBrake(latency);

      // A real drop must bite at once: never let a stale average hide it.
      const bufferNow = Math.min(health, engine.bufferEma);

      // Don't push against a connection that is already losing ground.
      if (engine.drainEma < LIVE_DRAIN_BRAKE_STEP_S) return restOrBrake(latency);

      // Hysteresis: engage only comfortably above the cushion (arming on the
      // smoothed value so a spike cannot re-arm a parked engine into sawtooth
      // cycling), and disengage the moment the buffer touches the cushion.
      if (engine.engaged) {
        if (bufferNow <= target) engine.engaged = false;
      } else if (engine.bufferEma > target + LIVE_ENGAGE_BAND_S) {
        engine.engaged = true;
      }
      if (!engine.engaged) return restOrBrake(latency);

      const demand = clamp01((latency - LIVE_MIN_LATENCY_S) / LIVE_LATENCY_FULL_S);
      const headroom = clamp01((bufferNow - target) / LIVE_BUFFER_RAMP_S);
      return 1 + (LIVE_CATCH_UP_RATE - 1) * demand * headroom;
    }

    /** Adaptive cushion: near-stall raises it (capped); comfort creeps it down. */
    function adjustAdaptiveTarget(health: number): number {
      const engine = liveEngine;
      if (health < LIVE_NEAR_STALL_S) {
        engine.target = Math.min(LIVE_AUTO_TARGET_MAX_S, engine.target + 1);
        engine.targetCooldown = LIVE_AUTO_COOLDOWN_TICKS;
      } else if (engine.targetCooldown > 0) {
        engine.targetCooldown -= 1;
      } else if (engine.bufferEma !== null && engine.bufferEma > engine.target + 2) {
        engine.target = Math.max(
          LIVE_AUTO_TARGET_MIN_S,
          engine.target - LIVE_AUTO_CREEP_S_PER_TICK
        );
      }
      return engine.target;
    }

    /**
     * Rest at 1x — or dip to 0.95x to rebuild a thin, still-draining cushion.
     * Deliberately timid: it fires only on a sustained drain, never goes below
     * LIVE_BRAKE_FLOOR_RATE, and fades out as latency climbs toward the drift
     * ceiling (the jump-to-live backstop is the failsafe).
     */
    function restOrBrake(latency: number): number {
      const bufferEma = liveEngine.bufferEma;
      if (bufferEma === null || bufferEma >= LIVE_BRAKE_START_S || liveEngine.drainEma >= 0) {
        return 1;
      }
      const budget = clamp01((LIVE_BRAKE_DRIFT_CEIL_S - latency) / LIVE_BRAKE_DRIFT_SPAN_S);
      const slowdown = Math.min(
        LIVE_BRAKE_GAIN * (LIVE_BRAKE_START_S - bufferEma),
        1 - LIVE_BRAKE_FLOOR_RATE
      );
      return 1 - slowdown * budget;
    }

    /**
     * Backstop for backlogs acceleration could not close (a long pause, a
     * reconnection): jumps straight to the live edge, like the reference
     * extension does by default. Re-arms once the latency recovers.
     */
    function maybeSkipToLive(player: YouTubePlayerElement, latency: number): void {
      const engine = liveEngine;
      if (latency < LIVE_SKIP_REARM_S) engine.skipped = false;
      if (engine.skipped || latency < LIVE_SKIP_TO_LIVE_S) return;
      if (!seekToLiveHead(player)) return;
      try {
        player.playVideo?.();
      } catch {
        /* the jump does not depend on this */
      }
      engine.skipped = true;
      debug('live delay: jumped to the live edge', { latencySeconds: round1(latency) });
    }

    /**
     * Writes the desired rate through the player API on the 0.05 grid, keeping
     * `video.playbackRate` mirrored. A rate that does not match what the
     * engine last wrote means the user changed the speed manually: the engine
     * backs off (and stops restoring) until they set it back to 1x.
     */
    function applyLiveRate(player: YouTubePlayerElement, desired: number): void {
      adoptEchoedRate(player);
      const engine = liveEngine;
      if (engine.rateYielded) return;

      const rate = quantizeRate(desired);
      if (Math.abs(rate - engine.appliedRate) > 0.01) {
        if (!writePlaybackRate(player, rate)) {
          engine.rateYielded = true;
          logLiveDelayNotice('playback rate API unavailable', {});
          return;
        }
        engine.appliedRate = rate;
      }
      syncVideoRate(player, engine.appliedRate);
    }

    /** Adopts the player's echoed rate; a foreign non-1x rate is the user's. */
    function adoptEchoedRate(player: YouTubePlayerElement): void {
      const echo = readPlaybackRate(player);
      const engine = liveEngine;
      if (echo === null || Math.abs(echo - engine.appliedRate) <= 0.01) return;
      if (Math.abs(echo - 1) <= 0.01) {
        engine.appliedRate = 1;
        engine.rateYielded = false;
        return;
      }
      engine.appliedRate = echo;
      engine.rateYielded = true;
      debug('live delay: manual speed change, backing off', { rate: echo });
    }

    /**
     * Returns playback to 1x whenever the engine is not actively catching up
     * (option off, left the live, paused, ad). This invariant also restores a
     * raise the engine left on the player when the user navigates to another
     * video.
     */
    function releaseLiveRate(player: YouTubePlayerElement): void {
      const engine = liveEngine;
      if (engine.rateYielded || Math.abs(engine.appliedRate - 1) <= 0.01) return;
      if (!writePlaybackRate(player, 1)) {
        engine.rateYielded = true;
        logLiveDelayNotice('playback rate API unavailable', {});
        return;
      }
      debug('live delay: rate restored', { previousRate: engine.appliedRate });
      engine.appliedRate = 1;
    }

    /** One debug line per behavior change (enter/leave catch-up, brake). */
    function logRateTransition(rateBefore: number, latency: number, buffer: number): void {
      const engine = liveEngine;
      if (engine.rateYielded) return;
      const rateAfter = engine.appliedRate;
      if (Math.abs(rateAfter - rateBefore) <= 0.011) return;
      if (rateAfter < 0.999) {
        debug('live delay: rebuilding the buffer', { rate: rateAfter });
      } else if (rateAfter > 1.001 && rateBefore <= 1.001) {
        debug('live delay: catching up', {
          rate: rateAfter,
          latencySeconds: round1(latency),
          bufferSeconds: round1(buffer)
        });
      } else if (rateAfter <= 1.001 && rateBefore > 1.001) {
        debug('live delay: catch-up resting', { rate: rateAfter });
      }
    }

    /** Rates are written on the player's 0.05 grid to avoid endless micro-writes. */
    function quantizeRate(rate: number): number {
      return Number((Math.round(rate / LIVE_RATE_STEP) * LIVE_RATE_STEP).toFixed(2));
    }

    /** Mirrors the engine rate on the <video> element (best effort). */
    function syncVideoRate(player: YouTubePlayerElement, rate: number): void {
      try {
        const video = player.querySelector('video');
        if (video && Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
      } catch {
        /* some media elements reject transient rates; the next tick retries */
      }
    }

    function createLiveEngine(): LiveEngineState {
      return {
        bufferEma: null,
        lastBuffer: null,
        drainEma: 0,
        engaged: false,
        backoff: false,
        target: LIVE_AUTO_TARGET_START_S,
        targetCooldown: 0,
        skipped: false,
        appliedRate: 1,
        rateYielded: false
      };
    }

    /**
     * Clears the control state when the video changes. The rate adoption
     * fields survive on purpose: a rate the engine raised on the previous
     * video must still be restored on the next one (see releaseLiveRate).
     */
    function resetLiveControl(engine: LiveEngineState): void {
      engine.bufferEma = null;
      engine.lastBuffer = null;
      engine.drainEma = 0;
      engine.engaged = false;
      engine.backoff = false;
      engine.target = LIVE_AUTO_TARGET_START_S;
      engine.targetCooldown = 0;
      engine.skipped = false;
    }

    function readVideoData(player: YouTubePlayerElement): PlayerVideoData | null {
      try {
        return player.getVideoData?.() ?? null;
      } catch {
        return null;
      }
    }

    function readProgress(player: YouTubePlayerElement): PlayerProgressState | null {
      try {
        return player.getProgressState?.() ?? null;
      } catch {
        return null;
      }
    }

    function readPlayerState(player: YouTubePlayerElement): number | null {
      try {
        const state = player.getPlayerState?.();
        return typeof state === 'number' ? state : null;
      } catch {
        return null;
      }
    }

    function clamp01(value: number): number {
      return value < 0 ? 0 : value > 1 ? 1 : value;
    }

    function round1(value: number): number {
      return Number(value.toFixed(1));
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
