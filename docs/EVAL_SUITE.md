# Eval suite — v2

Versioned, append-only set of `{goal, target metrics, weight}` triples that pipelines must beat to merge. Failing thresholds block merges (CI gate via `yarn bench`). Companion to [`AI_ENGINEERING.md`](./AI_ENGINEERING.md).

The eval suite IS the spec. New pipelines (or changes to existing pipelines: prompts, models, role assignments, params) ship only when they meet or beat the previous champion on the **statistically gated** weighted-mean metric.

Failure cases become evals. Boards that players flag, surprises in production traces, or unexpected regressions get promoted into this list as regression checks.

## What changed in v2

- Evals are **per-pipeline**, not just per-search-engine. Each pipeline (`p00-deterministic`, `p01-smart-router`, `p02-slm-mutator`, …) is benched against the full goal set.
- The promotion gate is **statistical** (paired-bootstrap CI), not threshold-only.
- New metric category: **diversity** (cross-board similarity) and **calibration** (judge ECE).
- New goal category: **prompt-driven** — free-form NL prompts with ground-truth structured goals; tests algorithm G (parsed prompt).
- New artifact: **`player-rated.parquet`** — calibrates the SLM judge.
- Output is the **leaderboard** with Pareto plot and per-metric CIs.

## Conventions

- **Append-only.** Don't change a goal once committed. Add a new goal id with the change.
- **Each goal targets a specific user experience.** Not "generate a board" but "generate a board that *feels* X."
- **Targets are floors, not goals.** `playerRelevantWords.mean >= 100` means we accept anything ≥ 100, not "aim for exactly 100."
- **Weights** are 0..1; the weighted-mean metric is `Σ (goal.weight × goal.score)`.
- **Pipelines run end-to-end.** We test the production code path, not internals.
- **Each metric has a comparison operator** (`>=`, `<=`, `==`, `contains`, `not-contains`, `>=p10`, `<=p90`).

## Metric categories

### Quality (per-board)

| Field | Meaning |
|---|---|
| `playerRelevantWords.mean` | Mean across N boards |
| `playerRelevantWords.p10` | 10th-percentile across N boards (downside protection) |
| `playerRelevantWords.p90` | 90th-percentile (upside) |
| `maxWordLength.mean` | Mean longest word per board |
| `wordsByLength.>=8.mean` | Mean count of 8+ letter words per board |
| `vowelRatio.deviation` | Mean abs deviation from `vowelRatioOptimumValue` |
| `prefixDiversity.mean` | Distinct 2-letter prefixes among player words |
| `letterEntropy.mean` | Shannon entropy on letter distribution |
| `goalAdherence.mean` | SLM-judge rating 0..1 of how well the board matches the goal description (calibrated) |

### Diversity (per-batch)

| Field | Meaning |
|---|---|
| `pairwiseJaccard.mean` | Mean Jaccard distance on player-word sets across N |
| `pairwiseLevenshtein.mean` | Mean Levenshtein on flat board strings |
| `vowelInventoryEntropyBits` | Shannon entropy on vowel multisets |
| `letterCoverage` | Distinct letters across the N boards (out of 26) |

### Cost (per-board)

| Field | Meaning |
|---|---|
| `meanElapsedMs` | Mean wall-clock per generation |
| `modelTokens.mean` | Total tokens (in+out) per generation |
| `candidatesEvaluated.mean` | Mean candidates the search engine evaluated |
| `usdPerBoard.mean` | $ on Workers AI (using model registry costs) |

### Calibration (per-pipeline)

| Field | Meaning |
|---|---|
| `floorMet.calibration` | ECE on `floorMet` claim vs realized |
| `judge.spearman` | Spearman ρ between SLM-judge and human-rated boards |
| `judge.agreement` | Fraction of pairs where judge and human agree on better-board |

### Reproducibility

| Field | Meaning |
|---|---|
| `playerRelevantWords.std` | Std-dev across N (lower = more reproducible) |
| `seedSensitivity` | Variance under seed perturbation (when supported) |

## Goals

```yaml
# id is stable; description is informational.
# Promotion-gated metrics are listed under `targets`.
# Diversity/cost/calibration are reported but not gated unless listed.

- id: default-balanced
  category: structured
  description: >
    The defaults the player gets on first load. Many interesting words
    across a range of lengths, with diverse boards.
  weight: 1.0
  config:
    size: 5
    minWordLength: 5
  runs: 20
  targets:
    playerRelevantWords.mean: ">= 150"
    playerRelevantWords.p10:  ">= 100"
    maxWordLength.mean:       ">= 6"
    pairwiseJaccard.mean:     ">= 0.4"
    vowelInventoryEntropyBits: ">= 4.0"
    letterCoverage:           ">= 22"
    meanElapsedMs:            "<= 8000"

- id: long-word-heavy
  category: structured
  description: Boards that incentivize long words.
  weight: 0.7
  config:
    size: 5
    minWordLength: 5
    style: long-word-heavy
  runs: 20
  targets:
    maxWordLength.mean:       ">= 7"
    wordsByLength.>=8.mean:   ">= 1"
    playerRelevantWords.mean: ">= 100"

- id: rare-letter-chaotic
  category: structured
  description: Rare letters present, chaotic vowel mix, broad letter coverage.
  weight: 0.6
  config:
    size: 5
    minWordLength: 5
    style: chaotic
    requiredLetters: [q, z]
  runs: 20
  targets:
    vowelInventoryEntropyBits: ">= 5.0"
    letterEntropy.mean:        ">= 4.0"
    # Will gate once requiredLetters honored by a generator (algo G):
    # containsRequiredLetters.fraction: ">= 0.8"

- id: classic-boggle
  category: structured
  description: Traditional 4x4 / 3+ letter Boggle.
  weight: 0.5
  config:
    size: 4
    minWordLength: 3
  runs: 20
  targets:
    playerRelevantWords.mean: ">= 60"
    playerRelevantWords.p10:  ">= 30"
    meanElapsedMs:            "<= 3000"

- id: vowel-rich
  category: structured
  description: High vowel ratio for friendlier boards.
  weight: 0.4
  config:
    size: 5
    minWordLength: 5
    style: balanced
    extra: { vowelRatioOptimumValue: 0.5 }
  runs: 20
  targets:
    vowelRatio.deviation: "<= 0.1"
    playerRelevantWords.mean: ">= 130"

# Prompt-driven goals for algorithm G (slm-parsed-prompt). Each prompt has a
# ground-truth structured goal that the parser is judged against. Boards
# generated downstream are judged with goalAdherence.mean.

- id: prompt-long-ing
  category: prompt-driven
  description: Free-form prompt → structured fields → board with -ING tail-friendliness.
  weight: 0.5
  prompt: "lots of long words ending in -ing"
  expectedGoal:
    style: long-word-heavy
    themedSuffixes: [ing]
  runs: 20
  targets:
    parser.f1: ">= 0.7"          # only meaningful for pipelines with prompt-parser
    goalAdherence.mean: ">= 0.6"  # judge says these match the prompt
    maxWordLength.mean: ">= 7"

- id: prompt-rare-no-q
  category: prompt-driven
  weight: 0.4
  prompt: "rare letters but no Q please, chaotic vibe"
  expectedGoal:
    style: chaotic
    avoidedLetters: [q]
  runs: 20
  targets:
    parser.f1: ">= 0.7"
    goalAdherence.mean: ">= 0.6"

# Calibration goals — explicitly test that the SLM judge agrees with humans.
# `player-rated.parquet` provides the human labels.

- id: calibration-judge-agreement
  category: calibration
  description: Run all pipelines, score boards with the judge, compare to human ratings.
  weight: 0.0  # not gating; reported alongside the leaderboard
  runs: 0       # uses player-rated.parquet directly
  targets:
    judge.spearman: ">= 0.5"
    judge.agreement: ">= 0.7"
```

20+ structured goals, 20+ prompt-driven goals, calibration goals. The above is the v2 starter set; goals are added as failures and edge cases surface.

## Per-pipeline reporting

For each pipeline × goal × N runs, results are written to `evals/results/<ts>__<pipeline>__<goal>.json`:

```json
{
  "pipeline": "p02-slm-mutator",
  "pipelineHash": "a3f1e9...",
  "goal": "default-balanced",
  "runs": 20,
  "boards": [{ "board": "abcde...", "score": {...}, "trace_id": "...", "elapsed_ms": 4200, "model_tokens": 320 }, ...],
  "metrics": {
    "quality":    { "playerRelevantWords": { "mean": 198, "p10": 165, "p90": 240, "std": 23 }, ... },
    "diversity":  { "pairwiseJaccard": { "mean": 0.42 }, ... },
    "cost":       { "meanElapsedMs": 4150, "modelTokens": { "mean": 320 } },
    "calibration": { "floorMet.ece": 0.04 }
  }
}
```

`evals/leaderboard.ts` aggregates these into a Pareto plot + per-metric paired-bootstrap CI table per (champion, challenger) pair.

## Statistical promotion gate

Pipelines compete on the **weighted-mean score** across goals:

`score(pipeline) = Σ_goal (goal.weight × allTargetsMet(pipeline, goal) ? 1 : partial-credit)`

But promotion isn't on this scalar alone. CI runs **paired-bootstrap** (10k resamples) on each metric for (champion, challenger) and produces:

- **Win count** — how many metrics the challenger beats the champion on with p<0.05
- **Loss count** — same in the other direction
- **Pareto frontier position** — points along (cost, quality)

**Promotion criteria** (all must hold):

1. `wins ≥ 1` on a quality metric
2. `losses == 0` on quality metrics
3. `cost.usdPerBoard.delta ≤ +50%` (no 10× regressions)
4. `calibration.ece` does not regress
5. PR description includes the leaderboard delta

Flat ties are not promoted (no churn for churn's sake).

## Calibration set: `player-rated.parquet`

Schema:

```
trace_id : string
board    : string
goal     : json
rating   : float (0..1)         # human rating
rater_id : string                # for inter-rater stats
captured_at : timestamp
```

Sources:

1. **In-app thumbs** (Player Feedback tab in the Lab) — opt-in.
2. **Internal rating sessions** — recorded by the team against held-out boards.

Held to ≥200 ratings before any judge metric is binding. Judge ECE / Spearman / agreement is reported every bench run; below threshold the judge is *demoted* (still runnable, but its `goalAdherence` no longer counts toward gating until it agrees with humans again).

## Running

```sh
yarn bench                                    # runs all pipelines × all goals
yarn bench --pipeline=p02-slm-mutator         # single pipeline
yarn bench --goal=long-word-heavy             # single goal across all pipelines
yarn bench --champion=p01 --challenger=p02    # head-to-head with paired CIs
yarn bench --shadow                           # production-tier compute, low-frequency
```

`yarn bench` writes:

- `evals/results/<ts>__<pipeline>__<goal>.json` — per-pipeline-per-goal raw
- `evals/leaderboard.json` — current leaderboard
- `docs/baselines/<ts>__bench-v2.json` — historical snapshot

## CI

A GitHub Action runs `yarn bench --champion=current --challenger=PR-pipeline` on each PR that touches `src/components/boggle/intelligence/**` or `src/components/boggle/generation/**`. The leaderboard delta is posted as a PR comment. Promotion-gate failures block merge.

## Versioning

This file is **v2**. v1 lives in git history. Every promotion bumps the leaderboard version; every goal addition keeps existing ids stable.
