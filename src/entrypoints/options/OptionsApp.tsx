import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FeaturesSettings } from '@/components/FeaturesSettings';
import { VideoRow } from '@/components/VideoRow';
import { useSettings } from '@/hooks/useSettings';
import { t } from '@/shared/i18n';
import {
  clearWatchedVideos,
  getWatchedVideos,
  removeWatchedVideo,
  watchedVideosToArray
} from '@/shared/storage';
import type { DeepPartial, Settings, WatchedVideoRecord } from '@/shared/types';

const PAGE_SIZE = 50;

export function OptionsApp() {
  const { settings, update } = useSettings();
  const [videos, setVideos] = useState<WatchedVideoRecord[]>([]);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const refreshVideos = useCallback(async (): Promise<void> => {
    const map = await getWatchedVideos();
    setVideos(watchedVideosToArray(map));
    setVisibleCount(PAGE_SIZE);
  }, []);

  useEffect(() => {
    void refreshVideos();
  }, [refreshVideos]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = useCallback((message: string): void => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return videos;
    return videos.filter(
      (video) =>
        (video.title || '').toLowerCase().includes(term) ||
        (video.channel || '').toLowerCase().includes(term)
    );
  }, [videos, query]);

  const visible = filtered.slice(0, visibleCount);

  function handleSettingsChange(patch: DeepPartial<Settings>): void {
    void update(patch).then(() => showToast(t('toastSettingsSaved')));
  }

  function handleRemove(id: string): void {
    void removeWatchedVideo(id)
      .then(() => refreshVideos())
      .then(() => showToast(t('toastVideoRemoved')));
  }

  function handleClear(): void {
    if (videos.length === 0) return;
    const confirmed = confirm(t('confirmClear', [String(videos.length)]));
    if (!confirmed) return;
    void clearWatchedVideos()
      .then(() => refreshVideos())
      .then(() => showToast(t('toastHistoryCleared')));
  }

  function handleExport(): void {
    const payload = {
      app: 'yt-essentials',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      videos
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yt-essentials-watched-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(t('toastExportDownloaded'));
  }

  if (!settings) return null;

  return (
    <>
      <header className="page-header">
        <h1>YT Essentials</h1>
        <p className="subtitle">{t('optionsSubtitle')}</p>
      </header>

      <main className="page-body">
        <FeaturesSettings settings={settings} onChange={handleSettingsChange} showDebug />

        <section className="card">
          <div className="card-header">
            <h2>
              {t('watchedVideosTitle')} <span className="badge">{filtered.length}</span>
            </h2>
            <div className="toolbar">
              <input
                type="search"
                placeholder={t('videosSearchPlaceholder')}
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
              />
              <button type="button" onClick={handleExport}>
                {t('exportJsonButton')}
              </button>
              <button type="button" className="danger" onClick={handleClear}>
                {t('clearAllButton')}
              </button>
            </div>
          </div>

          <div className="watched-list">
            {visible.map((video) => (
              <VideoRow key={video.id} video={video} onRemove={handleRemove} />
            ))}
          </div>

          {videos.length === 0 ? (
            <p className="empty">{t('emptyWatched')}</p>
          ) : null}
          {videos.length > 0 && filtered.length === 0 ? (
            <p className="empty">{t('emptySearch')}</p>
          ) : null}
          {filtered.length > visibleCount ? (
            <button
              type="button"
              className="load-more"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              {t('loadMoreButton')}
            </button>
          ) : null}
        </section>
      </main>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  );
}
