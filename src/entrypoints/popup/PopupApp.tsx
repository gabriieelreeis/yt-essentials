import { useEffect, useRef, useState } from 'react';
import { FeaturesSettings } from '@/components/FeaturesSettings';
import { useSettings } from '@/hooks/useSettings';
import { t } from '@/shared/i18n';
import type { DeepPartial, Settings } from '@/shared/types';

export function PopupApp() {
  const { settings, update } = useSettings();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  function handleChange(patch: DeepPartial<Settings>): void {
    void update(patch).then(() => {
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 1200);
    });
  }

  return (
    <>
      <header className="popup-header">
        <h1>YT Essentials</h1>
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </header>

      <main className="popup-body">
        {settings ? <FeaturesSettings settings={settings} onChange={handleChange} /> : null}
      </main>

      <footer className="popup-footer">
        <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
          {t('openOptionsButton')}
        </button>
        <span className={`saved${saved ? ' show' : ''}`} role="status">
          {t('savedBadge')}
        </span>
      </footer>
    </>
  );
}
