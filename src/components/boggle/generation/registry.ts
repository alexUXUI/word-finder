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
