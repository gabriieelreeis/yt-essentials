/**
 * YouTube fires custom events on `document` when it navigates between pages
 * (it is a SPA). Declaring them here makes
 * `document.addEventListener('yt-navigate-finish', ...)` type-check in every
 * content script. Importing this module has no runtime effect.
 */
declare global {
  interface DocumentEventMap {
    'yt-navigate-finish': Event;
    'yt-page-data-updated': Event;
  }
}

export {};
