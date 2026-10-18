import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/shared/theme.css';
import './style.css';
import { getUiLocale } from '@/shared/i18n';
import { PopupApp } from './PopupApp';

// The UI language follows the browser; expose it on <html> for a11y.
document.documentElement.lang = getUiLocale();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>
  );
}
