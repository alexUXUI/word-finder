/**
 * Calibration storage. The player rates boards via 👍/👎 in the dashboard;
 * each rating lands here. The bench step (`evals/calibrate.ts`) reads
 * exported JSON to compute Spearman ρ / ECE / agreement of the SLM judge
 * against human ratings.
 *
 * Until the judge crosses calibration thresholds (≥200 ratings AND
 * Spearman ≥ 0.5), its `goalAdherence` rating is reported but does NOT
 * gate pipeline promotion. See `EVAL_SUITE.md` §calibration.
 */

const RATINGS_KEY = 'word-finder.calibration.ratings';

export interface CalibrationRating {
  pipelineId: string;
  board: string;
  /** Stable string for joining ratings to bench traces. */
  goalSignature: string;
  /** Optional: if the player rated within a specific goal description. */
  goalDescription?: string;
  /** [0, 1] human rating. 1 = great, 0 = bad. Today's UI emits 0 or 1. */
  rating: number;
  /** Anonymous id; rotates per session. */
  raterId?: string;
  capturedAt: string;
}

export const loadRatings = (): CalibrationRating[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RATINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CalibrationRating[]) : [];
  } catch {
    return [];
  }
};

export const persistRating = (entry: CalibrationRating): void => {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadRatings();
    existing.push(entry);
    window.localStorage.setItem(RATINGS_KEY, JSON.stringify(existing));
  } catch {
    /* ignore */
  }
};

export const clearRatings = (): void => {
  try {
    window?.localStorage?.removeItem(RATINGS_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Browser → file: trigger a download of the ratings JSON so the bench
 * (Node) can read them. The bench expects `evals/ratings.json`.
 */
export const exportRatingsToFile = (): void => {
  if (typeof window === 'undefined') return;
  const ratings = loadRatings();
  const blob = new Blob([JSON.stringify(ratings, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ratings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
