import { browser } from 'wxt/browser';

/**
 * Extension UI translation, backed by Chrome's native i18n.
 *
 * All user-visible strings live in `public/_locales/<locale>/messages.json`
 * (en, pt_BR, es, ru, de). Chrome picks the language from the browser and
 * falls back to `default_locale: "en"` when the browser language is not one
 * of ours. WXT generates the `MessageKey` union from the en file, so a typo
 * in a key fails the type-check.
 *
 * `browser` (not `chrome`) is used here because WXT's generated overloads
 * only augment `wxt/browser`. This module is safe to import from any context:
 * nothing runs at import time, and a missing API degrades to the key itself.
 */

/** Every key declared in public/_locales/en/messages.json (plus built-ins). */
export type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

/** Returns the translated message; falls back to the key itself when missing. */
export function t(messageName: MessageKey, substitutions?: string | string[]): string {
  try {
    return browser.i18n.getMessage(messageName, substitutions) || messageName;
  } catch {
    return messageName;
  }
}

/** Browser UI language (e.g. "pt-BR"), used for dates and language names. */
export function getUiLocale(): string {
  try {
    return browser.i18n.getUILanguage() || 'en';
  } catch {
    return 'en';
  }
}

/**
 * Localized name of a language code (captions select), e.g. "Alemão" in a
 * pt-BR browser. `fallback` is the static English name from CAPTION_LANGUAGES,
 * used if the Intl API is unavailable. Not an i18n message on purpose: with
 * 30 caption languages this would mean hundreds of strings per locale, and
 * Intl handles any browser language for free.
 */
export function languageDisplayName(code: string, fallback: string): string {
  try {
    const display = new Intl.DisplayNames([getUiLocale()], { type: 'language' });
    return display.of(code) ?? fallback;
  } catch {
    return fallback;
  }
}
