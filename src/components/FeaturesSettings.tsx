import { Toggle } from '@/components/Toggle';
import { CAPTION_LANGUAGES, LIVE_DELAY_OPTIONS, QUALITY_LEVELS } from '@/shared/constants';
import { languageDisplayName, t } from '@/shared/i18n';
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
          label={t('watchedToggle')}
        />
        <p className="hint">{t('watchedHint')}</p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.quality.enabled}
          onChange={(enabled) => onChange({ quality: { enabled } })}
          label={t('qualityToggle')}
        />
        <div className="row">
          <label htmlFor="quality-value">{t('qualityLabel')}</label>
          <select
            id="quality-value"
            value={settings.quality.value}
            disabled={!settings.quality.enabled}
            onChange={(event) => onChange({ quality: { value: event.target.value as QualityValue } })}
          >
            <option value="auto">{t('qualityAuto')}</option>
            {QUALITY_LEVELS.map(({ value, label, labelKey }) => (
              <option key={value} value={value}>
                {labelKey ? t(labelKey) : label}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">{t('qualityHint')}</p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.captions.enabled}
          onChange={(enabled) => onChange({ captions: { enabled } })}
          label={t('captionsToggle')}
        />
        <div className="row">
          <label htmlFor="captions-language">{t('captionsLabel')}</label>
          <select
            id="captions-language"
            value={settings.captions.language}
            disabled={!settings.captions.enabled}
            onChange={(event) => onChange({ captions: { language: event.target.value } })}
          >
            {CAPTION_LANGUAGES.map(({ code, name }) => (
              <option key={code} value={code}>
                {languageDisplayName(code, name)}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">{t('captionsHint')}</p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.liveDelay.enabled}
          onChange={(enabled) => onChange({ liveDelay: { enabled } })}
          label={t('liveDelayToggle')}
        />
        <div className="row">
          <label htmlFor="live-delay-buffer">{t('liveDelayBufferLabel')}</label>
          <select
            id="live-delay-buffer"
            value={settings.liveDelay.buffer}
            disabled={!settings.liveDelay.enabled}
            onChange={(event) =>
              onChange({ liveDelay: { buffer: event.target.value as LiveDelayBuffer } })
            }
          >
            {LIVE_DELAY_OPTIONS.map(({ value, labelKey }) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          {t('liveDelayHintIntro')} {liveDelayOption ? t(liveDelayOption.hintKey) : ''}
        </p>
      </section>

      <section className="card">
        <Toggle
          checked={settings.skip.enabled}
          onChange={(enabled) => onChange({ skip: { enabled } })}
          label={t('skipToggle')}
        />
        <Toggle
          className="sub"
          checked={settings.skip.autoSkip}
          onChange={(autoSkip) => onChange({ skip: { autoSkip } })}
          disabled={!settings.skip.enabled}
          label={t('skipAutoToggle')}
        />
        <p className="hint">{t('skipHint')}</p>
      </section>

      {showDebug ? (
        <section className="card">
          <Toggle
            checked={settings.debug}
            onChange={(debug) => onChange({ debug })}
            label={t('debugToggle')}
          />
          <p className="hint">{t('debugHint')}</p>
        </section>
      ) : null}
    </>
  );
}
