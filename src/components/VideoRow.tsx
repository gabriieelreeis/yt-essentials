import { t } from '@/shared/i18n';
import type { WatchedVideoRecord } from '@/shared/types';
import { formatDuration, formatRelativeTime } from '@/shared/utils';

interface VideoRowProps {
  video: WatchedVideoRecord;
  onRemove: (id: string) => void;
}

function safeYouTubeUrl(video: WatchedVideoRecord): string {
  return /^https:\/\/(www\.)?youtube\.com\//.test(video.url)
    ? video.url
    : `https://www.youtube.com/watch?v=${video.id}`;
}

/** One entry of the watched-video history. */
export function VideoRow({ video, onRemove }: VideoRowProps) {
  const percent = Math.min(Math.max(video.percent || 0, 0), 100);
  const plays = video.playCount > 1 ? ` - ${t('videoPlayCount', [String(video.playCount)])}` : '';

  return (
    <article className="video">
      <img
        className="thumb"
        loading="lazy"
        alt=""
        src={`https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`}
      />
      <div className="meta">
        <a className="title" href={safeYouTubeUrl(video)} target="_blank" rel="noreferrer">
          {video.title || video.id}
        </a>
        <div className="channel">{video.channel || t('videoUnknownChannel')}</div>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="stats">
          {t('videoStats', [
            formatDuration(video.watchedSeconds),
            formatDuration(video.duration),
            String(percent),
            formatRelativeTime(video.lastWatchedAt)
          ])}
          {plays}
        </div>
      </div>
      <div className="actions">
        <button type="button" title={t('removeTitle')} onClick={() => onRemove(video.id)}>
          {t('removeButton')}
        </button>
      </div>
    </article>
  );
}
