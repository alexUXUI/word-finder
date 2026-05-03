# Eval suite — v1

Versioned, append-only set of `{goal, target metrics, weight}` triples that the system must beat to merge generation-affecting changes. Failing thresholds block merges (CI gate via `yarn eval`).

The eval suite IS the spec. New generators / prompts / models can ship only when they meet or beat the previous version on the weighted-mean metric.

Failure cases become evals. Boards that players flag, or surprises observed in production traces, get promoted into this list as regression checks.

## Conventions

- **Append-only.** Don't change a goal once committed. Add a new goal id with the change.
- **Each goal targets a specific user experience.** Not "generate a board" but "generate a board that *feels* X."
- **Targets are floors, not goals.** `playerRelevantWords.mean >= 100` means we accept anything ≥ 100, not "aim for exactly 100."
- **Weights** are 0..1; the weighted-mean metric the optimizer tunes against is `Σ (goal.weight × goal.score)`.
- **Eval runs use the search engine.** Single-shot generators don't get evaluated directly; they're wrapped by the search engine so we always test the production code path.

## Metrics expressible as targets

Targets read fields from the `BoardScore` (and `searchForBoard` result) returned by the system. Comparison operators: `>=`, `<=`, `==`, `contains`, `not-contains`.

| Target field | Type | What it means |
| --- | --- | --- |
| `playerRelevantWords.mean` | number | Mean across N runs of the goal |
| `playerRelevantWords.p10` | number | 10th-percentile across N runs |
| `playerRelevantWords.p90` | number | 90th-percentile across N runs |
| `maxWordLength.mean` | number | Mean longest word per board |
| `wordsByLength.>=8.mean` | number | Mean count of 8+ letter words |
| `vowelInventoryEntropyBits` | number | Shannon entropy on vowel multisets across the N runs |
| `letterCoverage` | number | Distinct letters seen across the N runs (out of 26) |
| `meanElapsedMs` | number | Mean wall-clock per generation |
| `containsRequiredLetters.fraction` | number | Fraction of N runs that include all required letters |
| `boardContains` | substring | At least one run contains this substring (sanity) |

## Goals

```yaml
# id is stable; description is informational
- id: default-balanced
  description: >
    The defaults the player gets on first load. Should produce many
    interesting words across a range of lengths, with diverse boards.
  weight: 1.0
  config:
    size: 5
    minWordLength: 5
    maxCandidates: 75
    maxMs: 5000
  runs: 30
  targets:
    playerRelevantWords.mean: ">= 100"
    playerRelevantWords.p10:  ">= 50"
    maxWordLength.mean:       ">= 6"
    vowelInventoryEntropyBits: ">= 4.0"
    # 22 (not 26) because rare letters (q, j, x, z) probabilistically don't
    # appear in 20 runs at their natural frequencies. The "letters can appear
    # at all" regression check lives in the unit suite (random-board.test.ts).
    letterCoverage:           ">= 22"
    meanElapsedMs:            "<= 2000"

- id: long-word-heavy
  description: >
    Boards that incentivize finding long words. Score weights bias
    toward maxWordLength and prefixDiversity.
  weight: 0.7
  config:
    size: 5
    minWordLength: 5
    maxCandidates: 75
    maxMs: 5000
    scoreWeights:
      maxWordLength: 12.0
      averageWordLength: 6.0
      playerRelevantWords: 0.5
  runs: 20
  targets:
    maxWordLength.mean:       ">= 7"
    wordsByLength.>=8.mean:   ">= 1"
    playerRelevantWords.mean: ">= 60"
    vowelInventoryEntropyBits: ">= 3.5"

- id: classic-boggle
  description: >
    The traditional 4x4 / 3+ letter Boggle experience. Lets us evolve
    5x5 / 5+ defaults without regressing the legacy mode.
  weight: 0.5
  config:
    size: 4
    minWordLength: 3
    maxCandidates: 50
    maxMs: 3000
  runs: 20
  targets:
    playerRelevantWords.mean: ">= 60"
    playerRelevantWords.p10:  ">= 30"
    meanElapsedMs:            "<= 2000"

# Future goals (not yet enforceable; current strategies don't honor preferences):
#
# - id: rare-letter-chaotic
#   weight: 0.4
#   config:
#     style: chaotic
#     requiredLetters: [q, z]
#   targets:
#     containsRequiredLetters.fraction: ">= 0.8"
#     vowelInventoryEntropyBits: ">= 5.0"
#
# - id: vowel-rich
#   weight: 0.3
#   config:
#     style: vowel-rich
#     scoreWeights:
#       vowelRatioOptimumValue: 0.5
#   targets:
#     vowelRatio.mean: ">= 0.45"
```

## Running

```sh
yarn eval                        # runs all goals, fails on any threshold miss
EVAL_GOALS=default-balanced yarn eval   # filter to specific goals
```

`yarn eval` writes `docs/baselines/<ts>__eval-v1.json` so the report is also a baseline artifact.

## Promotion gate

A change to generation, scoring, search, prompts, or models must beat the previous baseline on the **weighted-mean metric** (Σ goal.weight × goal.score, where goal.score is 1.0 if all targets met, otherwise 0.0). CI rejects PRs that regress this metric.

We will revisit weights and goals as data accumulates. Adjustments are themselves committed and traceable.
