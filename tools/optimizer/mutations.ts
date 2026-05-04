/**
 * Deterministic prompt mutations. Algorithm G v0 — applies preset textual
 * transforms to a baseline prompt to produce K distinct variants. Cheap,
 * reproducible, no extra model calls. The optimizer benches each variant
 * against the eval set; the winner gets manually promoted into prompts/.
 *
 * v1 (deferred): LLM-driven variant generation — give the baseline prompt
 * to an SLM with "rewrite this preserving intent" and collect K rewrites.
 */

export interface PromptVariant {
  /** Stable id within an optimizer run. */
  id: string;
  /** Short label for the leaderboard. */
  label: string;
  /** The mutated prompt text. */
  text: string;
}

/**
 * Apply preset deterministic mutations. Returns the baseline plus N
 * variants. Mutations chosen to span axes: structure, tone, strictness,
 * verbosity, format hints.
 */
export const generateVariants = (baseline: string): PromptVariant[] => {
  const variants: PromptVariant[] = [{ id: 'baseline', label: 'baseline', text: baseline }];

  // M1 — strip filler / parenthetical phrasing.
  variants.push({
    id: 'm1-tighten',
    label: 'tighter',
    text: baseline
      .replace(/\([^)]*\)/g, '')
      .replace(/[,;]\s+(?:e\.g\.|i\.e\.|for example|such as)[^.]*\./gi, '.')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  });

  // M2 — uppercase format directive (often improves JSON adherence on small SLMs).
  variants.push({
    id: 'm2-strict',
    label: 'all-caps directive',
    text: baseline.replace(
      /Reply with ([^.\n]+)\.?/g,
      'OUTPUT $1. NO OTHER TEXT.'
    ),
  });

  // M3 — drop the heuristics list (test whether they help or hurt).
  variants.push({
    id: 'm3-no-heuristics',
    label: 'no heuristics',
    text: baseline.replace(/Heuristics[\s\S]*?(?=\n\nDo NOT|\n\nReply|\n\nOutput|$)/i, ''),
  });

  // M4 — terse imperative (drop "You are…" framing).
  variants.push({
    id: 'm4-imperative',
    label: 'imperative',
    text: baseline
      .replace(/You are[^.\n]+\.\s*/i, '')
      .replace(/^\s*\n/g, '')
      .trim(),
  });

  // M5 — add concrete output example (gives the model a fixed-format cue).
  variants.push({
    id: 'm5-with-example',
    label: 'with example',
    text:
      baseline +
      '\n\nExample output: [{"i":3,"j":17,"rationale":"swap"}]',
  });

  // M6 — minimal: just the system role + format directive.
  const minimal = baseline.split('\n').filter((line) => /OUTPUT|Reply|JSON|format/i.test(line)).join('\n');
  if (minimal && minimal !== baseline) {
    variants.push({ id: 'm6-minimal', label: 'minimal', text: minimal });
  }

  return variants;
};
