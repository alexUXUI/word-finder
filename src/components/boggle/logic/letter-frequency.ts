/**
 * Pure, Qwik-free letter-frequency table + weighted sampler. Lives separately
 * from `board.ts` so non-UI consumers (bench runner, strategy registry,
 * tests) can import it without pulling Qwik's `$()` runtime.
 */

export const ENGLISH_LETTER_FREQUENCY: Readonly<Record<string, number>> = {
  a: 8.2,
  b: 1.5,
  c: 2.8,
  d: 4.3,
  e: 12.7,
  f: 2.2,
  g: 2.0,
  h: 6.1,
  i: 7.0,
  j: 0.15,
  k: 0.77,
  l: 4.0,
  m: 2.4,
  n: 6.7,
  o: 7.5,
  p: 1.9,
  q: 0.095,
  r: 6.0,
  s: 6.3,
  t: 9.1,
  u: 2.8,
  v: 0.98,
  w: 2.4,
  x: 0.15,
  y: 2.0,
  z: 0.074,
};

/**
 * Sample N letters with replacement from a weighted frequency table. Each
 * letter is drawn independently — counts vary across calls.
 */
export const sampleFromFrequency = (
  freqs: Readonly<Record<string, number>>,
  count: number
): string[] => {
  const entries = Object.entries(freqs);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let r = Math.random() * total;
    for (const [letter, w] of entries) {
      r -= w;
      if (r <= 0) {
        out.push(letter);
        break;
      }
    }
  }
  return out;
};
