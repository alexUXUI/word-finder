import { Language } from '../models';
import type { LanguageType } from '../models';
import type { BoardStrategy } from './types';
import { frequencyWeightedStrategy } from './strategies/frequency-weighted';
import { legacyRussianStrategy } from './strategies/legacy-russian';

const REGISTRY: Record<string, BoardStrategy> = {
  [frequencyWeightedStrategy.name]: frequencyWeightedStrategy,
  [legacyRussianStrategy.name]: legacyRussianStrategy,
};

export const registerStrategy = (strategy: BoardStrategy): void => {
  REGISTRY[strategy.name] = strategy;
};

export const getStrategy = (name: string): BoardStrategy | undefined =>
  REGISTRY[name];

export const listStrategies = (): readonly string[] =>
  Object.keys(REGISTRY).sort();

/**
 * Strategies that produce sensible boards for the given language. The
 * pipeline runner uses this to filter the StrategyRouter's option list —
 * an English goal must never be routed to a Russian-only strategy.
 *
 * A strategy is included if its `supportedLanguages` contains `language`.
 * Strategies with no `supportedLanguages` declared (legacy / pre-bug)
 * default to opting in to nothing, surfacing the gap.
 */
export const listStrategiesForLanguage = (
  language: LanguageType
): readonly string[] =>
  Object.values(REGISTRY)
    .filter((s) => s.supportedLanguages?.includes(language))
    .map((s) => s.name)
    .sort();

/**
 * Default strategy for a given language. Higher-level callers (search
 * engine, intelligence orchestrator) override this with deliberate choices.
 */
export const defaultStrategyForLanguage = (
  language: LanguageType
): BoardStrategy => {
  switch (language) {
    case Language.Russian:
      return legacyRussianStrategy;
    case Language.English:
    case Language.Spanish:
    default:
      return frequencyWeightedStrategy;
  }
};
