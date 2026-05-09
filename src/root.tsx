import { component$, useStyles$ } from '@builder.io/qwik';
import { QwikCityProvider, RouterOutlet } from '@builder.io/qwik-city';
import { RouterHead } from './components/router-head/router-head';

import globalStyles from './global.css?inline';

export default component$(() => {
  /**
   * The root of a QwikCity site always start with the <QwikCityProvider> component,
   * immediately followed by the document's <head> and <body>.
   *
   * Dont remove the `<head>` and `<body>` elements.
   */
  useStyles$(globalStyles);

  // Intentionally NOT rendering <ServiceWorkerRegister />. The Qwik
  // prefetch SW (compiled from src/routes/service-worker.ts) was the
  // origin of the stale-chunk bug — its hash-pinned cache became a
  // permanent 404 source after each redeploy. We replaced the SW source
  // with a kill-switch (public/service-worker.js) that unregisters
  // itself, and we no longer auto-register from the page. Legacy users
  // who already have a registration get cleaned up the next time their
  // browser auto-updates that SW (it'll fetch the kill-switch bytes,
  // install, activate, unregister). New visitors never register.

  return (
    <QwikCityProvider>
      <head>
        <meta charSet="utf-8" />
        <link rel="manifest" href="/manifest.json" />
        <RouterHead />
      </head>
      <body lang="en">
        <RouterOutlet />
      </body>
    </QwikCityProvider>
  );
});
