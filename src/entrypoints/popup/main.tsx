import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/shared/theme.css';
import './style.css';
import { PopupApp } from './PopupApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>
  );
}
