import { defineConfig } from 'wxt';

/**
 * YT Essentials - WXT (Vite) configuration.
 *
 * Source code lives in `src/` (`srcDir`):
 *   src/entrypoints/  -> extension entrypoints (popup, options, content scripts)
 *   src/shared/       -> framework-agnostic modules (storage, types, utils)
 *   src/components/   -> React components shared by popup and options
 *   src/hooks/        -> React hooks
 *
 * Build output: `.output/chrome-mv3/` (load this folder in Chrome).
 */
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // No auto-imports: every helper is imported explicitly, which keeps files
  // readable for humans and AI agents (and works without generated types).
  imports: false,
  manifest: {
    name: 'YT Essentials',
    // Resolved by Chrome from public/_locales/<browser language>/messages.json
    // (see src/shared/i18n.ts); "en" is the fallback for other languages.
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: '111',
    permissions: ['storage'],
    host_permissions: ['https://www.youtube.com/*'],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png'
    },
    action: {
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      }
    }
  }
});
