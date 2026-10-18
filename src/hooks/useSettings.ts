import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/shared/constants';
import { getSettings, updateSettings } from '@/shared/storage';
import type { DeepPartial, Settings } from '@/shared/types';

/**
 * Loads settings from chrome.storage.local, keeps them in sync with changes
 * made in other contexts and returns an `update` helper that persists patches.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = (): void => {
      void getSettings().then((next) => {
        if (!cancelled) setSettings(next);
      });
    };

    refresh();

    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEYS.settings]) refresh();
    };
    chrome.storage.onChanged.addListener(listener);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const update = useCallback(async (patch: DeepPartial<Settings>): Promise<Settings> => {
    const next = await updateSettings(patch);
    setSettings(next);
    return next;
  }, []);

  return { settings, update };
}
