import {
  ENGLISH_LETTER_FREQUENCY,
  sampleFromFrequency,
} from '../../logic/letter-frequency';
import { Language } from '../../models';
import type { BoardStrategy, BoardStrategyResult } from '../types';

/**
 * Independent per-cell sampling from the English letter frequency
 * distribution. Maximally diverse vowel inventory at the cost of word count
 * (uncoordinated letter placement). Phase 1.5's search engine compensates by
 * running this strategy many times and keeping the highest-scoring board.
 *
 * Tuned to the English alphabet but produces usable boards for Spanish too
 * (shared character set). NOT suitable for Russian — see `legacy-russian`.
 */
export const frequencyWeightedStrategy: BoardStrategy = {
  name: 'frequency-weighted',
  supportedLanguages: [Language.English, Language.Spanish],
  generate({ size }): BoardStrategyResult {
    const letters = sampleFromFrequency(ENGLISH_LETTER_FREQUENCY, size * size);
    return {
      board: letters.join(''),
      strategy: 'frequency-weighted',
      params: { distribution: 'english-letter-frequency' },
      seed: null,
    };
  },
};
