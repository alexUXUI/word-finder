/**
 * Pure, Qwik-free legacy letter pools + the original `generateRandomBoard`
 * generator. Lives separately from `board.ts` so non-UI consumers (bench
 * runner, the Russian strategy) can import without pulling Qwik's `$()`
 * runtime.
 *
 * The data is preserved verbatim; behavior is unchanged. Future cleanup
 * may consolidate or rebalance these pools — do that as part of a
 * benchmarked strategy change, not a quiet edit here.
 */

import { Language } from '../models';
import type { LanguageType } from '../models';

export const englishVowels = [
  'e','e','e','e','e','a','a','a','i','i','s','s',
];

export const englishConsonants = [
  'r','h','m','t','d','c','l','b','f','g','n','p','w',
];

export const englishUnpopularConsonants = [
  'j','k','k','q','v','x','y','y','y','z',
];

export const russianVowels = [
  'а','а','а','о','е','е','е','и','и','и','н',
];

export const russianConsonants = [
  'р','т','к','м','д','п','у','я','ы','ь','г','з','б','ч','й','х','ж','ш','ю','ц','щ','ф','э','с','в','л',
];

export const russianUnpopularConsonants = ['й', 'к'];

/**
 * Original board generator: zip vowels with consonants, sprinkle one
 * unpopular consonant, shuffle, pad/trim to size². Preserved for the
 * Russian strategy and for back-compat tests.
 */
export const generateRandomBoard = (
  length: number,
  language: LanguageType
): string => {
  const lengthSquared = length * length;

  let vowels: string[] = [];
  let consonants: string[] = [];
  let unpopularConsonants: string[] = [];

  switch (language) {
    case Language.Russian:
      vowels = russianVowels;
      consonants = russianConsonants;
      unpopularConsonants = russianUnpopularConsonants;
      break;
    case Language.English:
    case Language.Spanish:
    default:
      vowels = englishVowels;
      consonants = englishConsonants;
      unpopularConsonants = englishUnpopularConsonants;
  }

  const shuffledVowels = [...vowels].sort(() => 0.5 - Math.random());
  const shuffledConsonants = [...consonants].sort(() => 0.5 - Math.random());

  const zip = (a: string[], b: string[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < a.length; i++) {
      out.push(a[i]);
      if (i < b.length) out.push(b[i]);
    }
    return out;
  };

  const zipped = zip(shuffledVowels, shuffledConsonants);
  const unpopular =
    unpopularConsonants[Math.floor(Math.random() * unpopularConsonants.length)];
  const results = [...zipped, unpopular];
  const shuffledResults = results.sort(() => 0.5 - Math.random());

  if (lengthSquared > results.length) {
    const diff = lengthSquared - results.length;
    for (let i = 0; i < diff; i++) {
      const v = vowels[Math.floor(Math.random() * vowels.length)];
      const c = consonants[Math.floor(Math.random() * consonants.length)];
      results.push(Math.random() > 0.5 ? v : c);
    }
  } else if (lengthSquared < results.length) {
    const trimmed = [...results].sort(() => 0.5 - Math.random());
    trimmed.splice(lengthSquared, results.length);
    return trimmed.join('');
  }

  return shuffledResults.join('');
};
