# Baselines — the rule and the artifact

> **Rule.** Every change that *could* affect generated boards — algorithm, scoring, search engine, prompt, model, parameter, dictionary, or build pipeline — must be preceded by a baseline run and followed by a re-run. Both artifacts go in `docs/baselines/`. PR descriptions show the delta.

Without baselines, "this is better" is an opinion. Baselines make it a falsifiable claim.

## How to capture a baseline

```sh
# Label is required so the artifact filename is searchable later.
BENCH_LABEL="<short-name>" BENCH_GIT_SHA="$(git rev-parse --short HEAD)" yarn bench
```

Outputs:
- `docs/baselines/<iso-timestamp>__<label>.json` — committed, versioned, append-only.
- `docs/.benchmark-baseline.json` — pointer to the latest run, gitignored.

The bench is `tests/bench/baseline.test.ts`. It generates 100 boards via the current `randomBoard`, solves each, and records:
- **Timing**: solve mean / p10 / p90 / std-dev, candidates/sec.
- **Word counts**: total + player-relevant (5+) distribution.
- **Diversity**: pairwise Jaccard on 5+ word sets, pairwise Levenshtein on flat board strings.
- **Structural**: `distinctVowelMultisets`, `vowelMultisetEntropyBits`, vowel count stats, per-letter frequencies, `letterCoverage`, `lettersNeverSeen`, `bigramCoverage`.
- **Sample boards** (5 of N) with their full long-word lists for eyeball checks.

## Naming conventions

- `<label>` is kebab-case, descriptive, and *includes the change*: `current-generator-pre-phase1`, `phase1-vowel-pool-fix`, `phase1-frequency-weighted-strategy`, `phase1-search-engine-budget-5s`, `phase2-orchestrator-mock-provider`, etc.
- One baseline per *change*, not per session. Don't re-baseline mid-PR for the same code state.

## What "improvement" means per metric

| Metric | "Better" means | Today's value |
| --- | --- | --- |
| `wordCount.playerRelevant_5plus.mean` | higher | 91.5 |
| `wordCount.playerRelevant_5plus.p10` | higher | ~30 |
| `wordCount.playerRelevant_5plus.stdDev` | *not lower* — variance is fine, it's diversity | 33.8 |
| `diversity.jaccardOnPlayerRelevantWordSets.mean` | **lower** (less word overlap across boards) | 0.016 |
| `structural.distinctVowelMultisets` | higher (more vowel patterns) | **1** |
| `structural.vowelMultisetEntropyBits` | higher (more unpredictable vowel inventory) | **0.000** |
| `structural.vowelCount.stdDev` | higher (more variance in vowel density) | **0.000** |
| `structural.letterCoverage` | 26/26 | 24/26 |
| `structural.bigramCoverage` | higher (more letter pairs reachable) | 255/351 |
| `timing.candidatesPerSecond` | higher (or stable, not collapsing) | ~15 |

The bolded values above are the ones Phase 1's vowel-pool fix is expected to move. They're our measurable acceptance criteria.

## When to take a baseline

- **Before** opening a PR that changes generation behavior. Commit it.
- **After** the change lands on the branch. Commit it. Show the diff in the PR description.
- **When the dictionary updates.** Word counts will move; we want a clean before/after.
- **When the eval suite is run.** `yarn eval` (Phase 1+) writes its own structured artifact; the baseline bench is the *cross-cutting* picture, eval is per-goal.

## What's NOT in the baseline (yet)

The current bench measures the deterministic generator alone. Future additions, in order of priority:

1. **Per-goal baselines** (Phase 1, alongside eval suite v1). For each eval goal — default-balanced, rare-letter-chaotic, long-word-heavy, etc. — run N candidates through the search engine and record the per-goal score distribution.
2. **Solver throughput on WASM** (Phase 1 if hill-climb needs more headroom). Compare JS vs WASM solver candidates/sec.
3. **Build size baseline** (Phase 2, when models start landing). `dist/` size with and without intelligence layer; lazy-loaded model bundle separately.
4. **Page TTI baseline** (Phase 2, on the deployed Cloudflare Pages preview). Lighthouse run captured as a baseline.
5. **Trace overhead** (Phase 2, when tracer ships). Mean ms added by tracer per generation, mean trace size in bytes.
6. **Online metrics** (Phase 3+, when feedback capture lands). Player engagement signals as cohort baselines: `time_to_first_word_ms`, `did_complete`, `did_rage_quit`.

Each becomes a row in this doc with its own artifact format.

## Baseline-first in commit messages

PR descriptions should look like:

```
## Phase 1 — Vowel pool fix

Replaces englishVowels with a frequency-weighted real-vowel pool.

Baselines:
- before: docs/baselines/2026-05-03T19-12-37-790Z__current-generator-pre-phase1.json
- after:  docs/baselines/<new-timestamp>__phase1-vowel-pool-fix.json

Δ:
  distinctVowelMultisets: 1 → ___
  vowelMultisetEntropyBits: 0.000 → ___
  vowelCount.stdDev: 0.000 → ___
  letterCoverage: 24/26 → ___
  lettersNeverSeen: o,u → ___
  meanFivePlusWords: 91.5 → ___
  meanJaccard: 0.016 → ___
```

Numbers in, numbers out. No claim of "better" without a row of evidence.
