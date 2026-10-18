import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/shared/theme.css';
import './style.css';
import { getUiLocale, t } from '@/shared/i18n';
import { OptionsApp } from './OptionsApp';

// The UI language follows the browser; expose it on <html> for a11y and
// localize the tab title (the static <title> is just the English fallback).
document.documentElement.lang = getUiLocale();
document.title = t('optionsTitle');

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <OptionsApp />
    </StrictMode>
  );
}
