import {
  ENGLISH_LETTER_FREQUENCY,
  sampleFromFrequency,
} from '../../logic/letter-frequency';
import type { BoardStrategy, BoardStrategyResult } from '../types';

/**
 * Independent per-cell sampling from the English letter frequency
 * distribution. Maximally diverse vowel inventory at the cost of word count
 * (uncoordinated letter placement). Phase 1.5's search engine compensates by
 * running this strategy many times and keeping the highest-scoring board.
 */
export const frequencyWeightedStrategy: BoardStrategy = {
  name: 'frequency-weighted',
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
