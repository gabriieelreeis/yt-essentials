import { Toggle } from '@/components/Toggle';
import { CAPTION_LANGUAGES, LIVE_DELAY_OPTIONS, QUALITY_LEVELS } from '@/shared/constants';
import type { DeepPartial, LiveDelayBuffer, QualityValue, Settings } from '@/shared/types';

interface FeaturesSettingsProps {
  settings: Settings;
  onChange: (patch: DeepPartial<Settings>) => void;
  /** The debug toggle is only shown on the options page. */
  showDebug?: boolean;
}

/**
 * The feature toggles, shared by the popup and the options page so the two
 * surfaces can never drift apart.
 */
export function FeaturesSettings({ settings, onChange, showDebug = false }: FeaturesSettingsProps) {
  const liveDelayOption = LIVE_DELAY_OPTIONS.find(
    (option) => option.value === settings.liveDelay.buffer
  );

  return (
    <>
      <section className="card">
        <Toggle
          checked={settings.watched.enabled}
          onChange={(enabled) => onChange({ watched: { enabled } })}
          label="Save watched videos"
        />
        <p className="hint">
          Stores title, channel, watched time, duration, percentage and dates for every video you
          watch. Everything stays in this browser.
        </p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.quality.enabled}
          onChange={(enabled) => onChange({ quality: { enabled } })}
          label="Force video resolution"
        />
        <div className="row">
          <label htmlFor="quality-value">Resolution</label>
          <select
            id="quality-value"
            value={settings.quality.value}
            disabled={!settings.quality.enabled}
            onChange={(event) => onChange({ quality: { value: event.target.value as QualityValue } })}
          >
            <option value="auto">Auto</option>
            {QUALITY_LEVELS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          If the video does not offer the chosen quality, the best quality below it is used.
        </p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.captions.enabled}
          onChange={(enabled) => onChange({ captions: { enabled } })}
          label="Turn on captions"
        />
        <div className="row">
          <label htmlFor="captions-language">Language</label>
          <select
            id="captions-language"
            value={settings.captions.language}
            disabled={!settings.captions.enabled}
            onChange={(event) => onChange({ captions: { language: event.target.value } })}
          >
            {CAPTION_LANGUAGES.map(({ code, name }) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          Uses the auto-generated track of that language when available, falling back to human
          captions or a translated track.
        </p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.liveDelay.enabled}
          onChange={(enabled) => onChange({ liveDelay: { enabled } })}
          label="Reduce live delay"
        />
        <div className="row">
          <label htmlFor="live-delay-buffer">Buffer</label>
          <select
            id="live-delay-buffer"
            value={settings.liveDelay.buffer}
            disabled={!settings.liveDelay.enabled}
            onChange={(event) =>
              onChange({ liveDelay: { buffer: event.target.value as LiveDelayBuffer } })
            }
          >
            {LIVE_DELAY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          Only affects live streams, while they are playing: playback is dragged back whenever it
          drifts more than the chosen buffer behind the live edge. {liveDelayOption?.hint}
        </p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.skip.enabled}
          onChange={(enabled) => onChange({ skip: { enabled } })}
          label="Next video button"
        />
        <Toggle
          className="sub"
          checked={settings.skip.autoSkip}
          onChange={(autoSkip) => onChange({ skip: { autoSkip } })}
          disabled={!settings.skip.enabled}
          label="Skip automatically"
        />
        <p className="hint">
          On videos you already watched (90% or more), shows a button in the player that goes to
          the next video. With automatic skipping, it goes there by itself. Never applies to live
          streams.
        </p>
      </section>

      {showDebug ? (
        <section className="card">
          <Toggle
            checked={settings.debug}
            onChange={(debug) => onChange({ debug })}
            label="Debug logging"
          />
          <p className="hint">
            Prints extra information to the browser console. Useful when something is not working.
          </p>
        </section>
      ) : null}
    </>
  );
}
