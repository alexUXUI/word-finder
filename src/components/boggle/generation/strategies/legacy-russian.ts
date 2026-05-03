import { generateRandomBoard } from '../../logic/board';
import { Language } from '../../models';
import type { BoardStrategy, BoardStrategyResult } from '../types';

/**
 * Wraps the original zip-based generator for Russian. Inherits the same
 * structural quirks the English generator had (fixed pool, fixed counts) —
 * Russian-specific fixes are out of scope for Phase 1; revisit when we add
 * multi-language strategies.
 */
export const legacyRussianStrategy: BoardStrategy = {
  name: 'legacy-russian',
  generate({ size }): BoardStrategyResult {
    return {
      board: generateRandomBoard(size, Language.Russian),
      strategy: 'legacy-russian',
      params: { language: Language.Russian, generator: 'zip-based' },
      seed: null,
    };
  },
};
