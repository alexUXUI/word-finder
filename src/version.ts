/**
 * App version metadata, populated at build time via `define` in vite.config.ts.
 *
 * On Cloudflare Pages we use the build-injected `CF_PAGES_COMMIT_SHA` and
 * `CF_PAGES_BRANCH`; locally we shell out to git. The result is the same
 * shape regardless of environment.
 *
 * Available at runtime via:
 *   - `window.__APP_VERSION__` (set by `installVersionGlobals()` on hydration)
 *   - `localStorage.getItem('word-finder.version')`
 *   - The footer component renders the short SHA visibly
 *   - Console: `console.log('[word-finder]', APP_VERSION)` on first load
 */

declare const __APP_VERSION_SHA__: string;
declare const __APP_VERSION_FULL_SHA__: string;
declare const __APP_VERSION_BRANCH__: string;
declare const __APP_VERSION_BUILD_TIME__: string;

export interface AppVersion {
  /** Short SHA (first 7 chars of HEAD). */
  sha: string;
  /** Full SHA. */
  fullSha: string;
  /** Branch name. */
  branch: string;
  /** ISO 8601 build timestamp. */
  buildTime: string;
}

export const APP_VERSION: Readonly<AppVersion> = Object.freeze({
  sha:
    typeof __APP_VERSION_SHA__ !== 'undefined' ? __APP_VERSION_SHA__ : 'unknown',
  fullSha:
    typeof __APP_VERSION_FULL_SHA__ !== 'undefined'
      ? __APP_VERSION_FULL_SHA__
      : 'unknown',
  branch:
    typeof __APP_VERSION_BRANCH__ !== 'undefined'
      ? __APP_VERSION_BRANCH__
      : 'unknown',
  buildTime:
    typeof __APP_VERSION_BUILD_TIME__ !== 'undefined'
      ? __APP_VERSION_BUILD_TIME__
      : new Date(0).toISOString(),
});

const STORAGE_KEY = 'word-finder.version';

/**
 * Wire the version into runtime-discoverable surfaces. Idempotent.
 * Call once on hydration.
 */
export const installVersionGlobals = (): void => {
  if (typeof window === 'undefined') return;
  // window.__APP_VERSION__ — visible in DevTools console
  (window as unknown as { __APP_VERSION__?: AppVersion }).__APP_VERSION__ =
    APP_VERSION;
  // localStorage — survives reloads, scriptable
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(APP_VERSION));
  } catch {
    /* private browsing or storage disabled — non-fatal */
  }
  // Console banner — easy to see in any tab
  // eslint-disable-next-line no-console
  console.log(
    `%c[word-finder] v${APP_VERSION.sha} · ${APP_VERSION.branch} · built ${APP_VERSION.buildTime}`,
    'color: #225; font-weight: 600;'
  );
};
