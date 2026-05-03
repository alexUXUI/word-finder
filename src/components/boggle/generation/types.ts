import type { LanguageType } from '../models';

/**
 * Configuration passed to every strategy. Strategies may declare and consume
 * additional fields via their own param types — `extra` is the catch-all bag.
 */
export interface BoardStrategyConfig {
  size: number;
  language: LanguageType;
  seed?: number | null;
  /** Strategy-specific knobs. Each strategy documents its own keys. */
  extra?: Readonly<Record<string, unknown>>;
}

export interface BoardStrategyResult {
  /** Flat row-major string of length `size * size`. */
  board: string;
  /** Strategy name as registered in the registry. */
  strategy: string;
  /** Echoes back any params the strategy actually used (for traceability). */
  params: Readonly<Record<string, unknown>>;
  /** Seed actually used (null if unseeded). */
  seed: number | null;
}

export interface BoardStrategy {
  /** Stable name; matches the registry key. */
  readonly name: string;
  /** Returns a single candidate board with metadata. */
  generate(config: BoardStrategyConfig): BoardStrategyResult;
}
