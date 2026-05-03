import { component$ } from '@builder.io/qwik';
import { APP_VERSION } from '../../version';

/**
 * Small, unobtrusive version footer. Renders the short SHA + the build
 * date so every deployed version is verifiable at a glance — and matches
 * what's also in `window.__APP_VERSION__` and `localStorage["word-finder.version"]`.
 */
export const VersionFooter = component$(() => {
  // YYYY-MM-DD HH:MM (UTC) — keep the footer compact.
  const builtDateUtc = APP_VERSION.buildTime.replace(
    /T(\d{2}:\d{2}).*/,
    ' $1Z'
  );
  return (
    <div
      data-testid="version-footer"
      data-version-sha={APP_VERSION.sha}
      data-version-branch={APP_VERSION.branch}
      data-version-build-time={APP_VERSION.buildTime}
      style="position: fixed; bottom: 4px; right: 8px; font-size: 10px; color: #678; font-family: ui-monospace, monospace; opacity: 0.55; pointer-events: auto; user-select: text;"
      title={`Branch: ${APP_VERSION.branch}\nFull SHA: ${APP_VERSION.fullSha}\nBuilt: ${APP_VERSION.buildTime}`}
    >
      v{APP_VERSION.sha} · {builtDateUtc}
    </div>
  );
});
