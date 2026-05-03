/**
 * Versioned prompts and post-processors for the Narrator role's SLM
 * implementation. The hard "no spoilers" rule is encoded in
 * `EXPLAIN_SYSTEM` and enforced by the runner not passing words/letters in
 * the user message.
 */

export const EXPLAIN_PROMPT_VERSION = '1.0.0';

export const EXPLAIN_SYSTEM = `You are a Word Finder coach. Reply with EXACTLY ONE short sentence. Stop after the first sentence — do not repeat yourself, do not add another sentence.

HARD RULE — NEVER spoil specific words. Do NOT name, quote, or hint at any actual word that can be found on the board. No quoted strings, no examples like "x", no spelling out letters.

Hype the player about *qualities*: long-word potential, letter mix, rare letters, prefix/suffix opportunities, vibe. No greetings, no preamble, no repetition.`;

/**
 * Strip duplicate sentences — small models often produce "X. X. X." with any
 * headroom. Trims to unique sentences in original order.
 */
export const dedupeSentences = (text: string): string => {
  if (!text) return '';
  const parts = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/[^a-z0-9 ]+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 2) break;
  }
  return out.join(' ').trim();
};
