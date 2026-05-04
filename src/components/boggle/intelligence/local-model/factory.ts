/**
 * Provider factory + lazy cache. Pipelines can specify a different model
 * per role; the runner uses this factory to instantiate the right
 * `LocalModelProvider` for each role on demand.
 *
 * The cache is keyed by SLM id so multiple roles using the same model
 * share one provider instance (avoids paying download + load cost per
 * role). Cache lives module-scope intentionally — the player's
 * Transformers.js model is naturally a singleton across the page.
 */

import type { LocalModelProvider } from './types';
import { SLM_REGISTRY, type SlmModel } from './device-tier';
import { TransformersJsProvider } from './transformers-js';
import { CloudflareServerProvider } from './cloudflare-server-provider';

const CACHE = new Map<string, LocalModelProvider>();

const findEntry = (id: string): SlmModel | undefined =>
  SLM_REGISTRY.find((m) => m.id === id);

/**
 * Pre-register a provider for an id. Used by:
 *   - The bench runner (registers a mock for every SLM id so cascade /
 *     self-consistent pipelines work without a real model).
 *   - Unit tests.
 *   - The Lab (caches the user's loaded provider so cascade routers
 *     reuse it).
 *
 * If a registered provider already exists for the id, this overwrites it.
 */
export const setProviderForId = (
  id: string,
  provider: LocalModelProvider
): void => {
  CACHE.set(id, provider);
};

/**
 * Instantiate (or fetch from cache) a `LocalModelProvider` for an SLM id
 * from the registry. Throws on unknown id so misconfigured pipelines fail
 * loudly instead of silently picking the wrong model.
 *
 * Note: providers returned here are *not yet loaded*. The pipeline runner
 * (or caller) is responsible for `await provider.load()` before calling
 * `generate()`. Multiple callers awaiting `load()` on the same instance
 * is safe — `TransformersJsProvider.load` is idempotent.
 */
export const getProviderForId = (id: string): LocalModelProvider => {
  const cached = CACHE.get(id);
  if (cached) return cached;

  if (id === 'cloudflare-server') {
    const p = new CloudflareServerProvider();
    CACHE.set(id, p);
    return p;
  }

  const entry = findEntry(id);
  if (!entry) {
    throw new Error(
      `Unknown SLM id "${id}". Registered: ${SLM_REGISTRY.map((m) => m.id).join(', ')}`
    );
  }
  const p = new TransformersJsProvider({ modelId: entry.modelId });
  CACHE.set(id, p);
  return p;
};

/** Reset for tests; never called in production code paths. */
export const _resetProviderCacheForTests = (): void => {
  CACHE.clear();
};
