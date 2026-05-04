# AI engineering for Word Finder — pipelines, algorithms, benchmarks

This is the **source of truth** for how board generation is engineered. It supersedes the framing in `INTELLIGENT_GENERATION.md` (which describes the current single-pipeline flow as if the SLM were a knob bolted onto a procedure).

The thesis: a board is a **discrete optimization problem with a fuzzy, language-described objective.** Neither pure search nor pure language models solve it well alone. The product is the **composition** — deterministic primitives wrapped by model-driven decisions at the points where domain knowledge or natural language matters — and the deployment is whichever **pipeline is current champion** on a benchmarked leaderboard.

Concretely:

- **Pipelines are first-class config-driven objects.** Versioned, hashed, swappable. A pipeline is a graph of *roles*; each role has multiple *implementations*; an *assignment* picks one implementation per role.
- **Roles are interfaces, not procedures.** The current Smart Mode is one config (rule-based router + frequency-weighted generator + deterministic critic + argmax aggregator + SLM narrator). Other configs are equally valid.
- **Algorithms put the model in the loop, not at the boundary.** SLM as a *mutator* in hill-climb. SLM as a *crossover operator* in evolutionary search. SLM as a *critic* that scores candidates. SLM as a *policy* in MCTS over partial boards.
- **Benchmarks decide what ships.** Every pipeline change runs against the eval set; promotion gated on statistical wins on the Pareto frontier of cost vs quality.
- **The in-app Pipeline Lab** is where you compose, bench, inspect traces, optimize prompts, and crown the next champion. Smart Mode in the player UI = whoever is champion right now.

## 1 — Pipelines as first-class objects

A `Pipeline` is a config:

```ts
{
  id: 'p02-slm-mutator',
  version: '1.0.0',
  description: 'Random sample → SLM-driven hill climb → deterministic score → SLM narrate',
  roles: {
    'prompt-parser':       { impl: 'noop' },
    'strategy-router':     { impl: 'rule-based',          params: { default: 'frequency-weighted' } },
    'candidate-generator': { impl: 'best-of-n',           params: { samples: 50 } },
    'mutator':             { impl: 'slm-swap',            params: { iterations: 8, k: 3 }, model: 'qwen2.5-0.5b' },
    'critic':              { impl: 'deterministic-scorer' },
    'aggregator':          { impl: 'argmax' },
    'narrator':            { impl: 'slm-narrator',        model: 'smollm2-360m' },
  },
}
```

Each pipeline has a stable `id`, a hash of its full assignment (so eval results are joinable), and a card on the leaderboard showing its current scores per metric.

Pipelines live in `src/components/boggle/intelligence/pipelines/` as TS files (typed configs) so the same definitions are buildable, testable, and refactorable as code.

## 2 — Roles

Seven roles. Each defines an interface; multiple implementations may live behind it.

| Role | Input | Output | Implementations (current → planned) |
|---|---|---|---|
| `PromptParser` | NL prompt + optional structured goal | `BoardGenerationGoal` | `noop` (passthrough), `regex` baseline → `slm-parser` (free-form → structured fields), `distilled-classifier` |
| `StrategyRouter` | goal | strategy id + params | `rule-based` (heuristic table), `slm-router` (today's `model.pick_strategy`) → `learned-classifier`, `self-consistent-slm` |
| `CandidateGenerator` | goal, strategy id+params, **optional** seed-board | stream of `(board, score)` | `best-of-n` (calls strategy.generate × N), `n-gram` → `seed-word`, `dice-shuffle`, `slm-letter-policy` (SLM proposes each cell), `mcts` |
| `Mutator` | board, score, goal | swap proposals | `random-swap` (baseline), `slm-swap` (SLM proposes 3 swaps with rationale) → `gradient-via-trie`, `evolutionary-crossover` (operates on parents pair) |
| `Critic` | board, score, goal | quality 0..1 | `deterministic-scorer` (today's `scoreBoard`), `slm-judge` (rates fit-to-goal) → `ensemble`, `learned-reranker` |
| `Aggregator` | batch of `(board, score, critic)` | winner + report | `argmax` (max final_score), `pareto` (multi-metric frontier), `llm-rerank`, `bandit` |
| `Narrator` | board, score, goal | explanation string | `noop` (empty), `slm-narrator` (today's `model.explain` + dedupe) → `template-narrator` (deterministic, no model) |

A pipeline composes them. The runner walks the graph, threading state.

## 3 — The algorithms (model-in-the-loop, not bolted on)

Ranked by leverage (highest first). Each is a pipeline config — an algorithm is *what the pipeline does*, not a separate codebase.

### A — SLM-mutated hill-climb (`p02-slm-mutator`)

Loop K times: SLM gets `(board, score, goal)`, returns 3 letter-swap proposals with rationale. Apply each, score, keep best. **SLM is the local-search policy.** Random hill-climb encodes no English priors; SLM-proposed swaps do — *"swap that lone Q, the QU prefix isn't reachable from this row."* Bench question: does SLM-proposed swap dominate random swap at matched compute?

### B — Evolutionary search with SLM-as-crossover (`p03-evolutionary`)

Pop=50, top-K survives each generation. SLM proposes children given parent pairs: *"parent A has -ING-tail-friendly NW, parent B has rare-letter density east — combine these subgrids."* Mutate via (A). Bench against random sampling at matched compute. Pareto question: does the SLM move the cost-vs-quality frontier?

### C — Verifier–generator loop (`p04-critic-rerank`)

Generator emits N candidates. SLM critic rates each against the *goal description* (subjective fit, not the deterministic scorer). Accept above threshold OR rerank. The eval question: does critic rating predict held-out player satisfaction? (Requires the player-rated calibration set in §5.)

### D — MCTS with SLM letter-placement policy (`p05-mcts`)

Build cell-by-cell. SLM is the prior over what letter to place next given partial board + goal. UCB selects branches; rollouts complete the board with the deterministic generator and the scorer is the value estimate. Far more compute than (A)/(B) but the only path to *reactive construction* where the prompt directly shapes which cells get which letters. Research-tier item; ship behind a flag.

### E — Cascade routing (`p06-cascade`)

SmolLM2-135M handles 80% of `pick_strategy` calls. Escalate to 360M only if confidence is low (entropy or self-rating). Escalate to 0.5B / Llama-3.2-1B only on complex multi-constraint goals. Standard frontier-model technique scaled down.

### F — Self-consistency on strategy choice (`p07-self-consistent`)

Run `pick_strategy` × 5 at T=0.7, majority-vote. Cheap variance reduction.

### G — SLM-parsed prompt → structured goal (`p08-parsed-prompt`)

Free-form Builder prompt → `{style, requiredLetters, avoidedLetters, novelty, lengthBias, themedSuffixes}`. Today the prompt is decorative. F1 metric against held-out prompts with ground-truth structured goals.

### H — Distillation chain (`p09-distilled-parser`)

Capture (prompt, structured-goal, board, score, judge-rating) tuples from heavier pipelines. Train SmolLM2-135M as task-specific replacement for any role. Production runs the small distilled model at near-zero latency. **Closes the loop**: traces become training data.

### Composition primitives

- **Cascade**: A → B if A is low-confidence. Pipeline composes two role implementations with a confidence gate.
- **Ensemble**: vote across A, B, C. Aggregator runs the same role multiple ways and aggregates.
- **Critic-and-generator**: A generates, B judges. Critic role rates output of CandidateGenerator.
- **Distillation**: capture from B, train A. Offline; produces a new role implementation.

## 4 — Model registry, by capability

Today's `SLM_REGISTRY` is keyed by *device capacity*. That's a deployment policy, not a registry. Restructure:

**Model registry** — by id, with capabilities and cost:

```ts
{
  id: 'transformers-js:smollm2-135m',
  family: 'smollm2',
  paramCount: 135_000_000,
  approxSizeMb: 110,
  runtime: 'transformers-js',
  device: 'on-device',
  capabilities: { json: true, streaming: true, toolCalling: false, maxCtx: 8192 },
  costPer1kTokens: 0,           // on-device → no $ cost
  p50LatencyMs: 200,
}
```

**Pipelines pin a model per role** — a role assignment may say `model: 'qwen2.5-0.5b'` to override the pipeline default. This decouples "which pipeline to run" from "which model runs each step."

**Deployment policy** is an outer layer: device-tier picker chooses a deployment (pure-server for iOS, on-device-with-server-fallback for desktop) which substitutes models per role. The current device-tier code becomes one of these policies.

## 5 — Benchmarks (eval-as-spec, statistical, Pareto-aware)

`evals/` is the spec. Every pipeline change runs against it; promotion is statistically gated.

```
evals/
  goals.yaml              # 20+ structured goals across 5 categories
  prompts.yaml            # 20+ free-form prompts → ground-truth structured goals
  player-rated.parquet    # ~200 human-scored boards, calibrates the SLM judge
  run-bench.ts            # for each pipeline × goal × N=20 → results.json
  leaderboard.ts          # paired-bootstrap CIs, Pareto plot
  pipelines/              # config refs into intelligence/pipelines/
  results/                # historical runs, parquet/json, gitignored
```

**Per (pipeline × goal × N=20 boards)** we capture:

- **Quality**: `playerRelevantWords`, `maxWordLength`, `vowelRatio` deviation from target, `prefixDiversity`, `letterEntropy`, **`goalAdherence`** (calibrated SLM judge)
- **Diversity**: pairwise Jaccard / Levenshtein / embedding distance across the batch
- **Cost**: model tokens (in+out), candidates evaluated, wall ms, $/board on Workers AI
- **Calibration**: claimed `floorMet` vs realized; ECE on the judge
- **Reproducibility**: variance across seeds

**Statistical comparison.** Paired-bootstrap CIs (10k resamples) on every metric between champion and challenger on each goal. **CI gate**: PR must show statistical win on ≥1 metric AND no regression elsewhere. `yarn bench` writes the leaderboard; CI parses it.

**Champion/challenger.** The production pipeline is whichever has the highest weighted-mean score on the goal set. Promotion happens through CI; rollback is a single `champion: 'p01-smart-router'` change in config.

**Calibration.** The SLM judge is only useful if it correlates with humans. The `player-rated.parquet` set (player thumbs from production, 200+ labels) is the ground truth. Judge ECE / Spearman / agreement reported alongside the leaderboard. A judge that can't agree with humans gets demoted.

## 6 — The Pipeline Lab (replaces Board Builder)

In-app surface for AI engineering, not just batch-running:

| Tab | Surface |
|---|---|
| **Pipelines** | Card per registered pipeline. Shows `id`, role assignments, last eval scores, Pareto position, "promote to champion" button. |
| **Bench** | Pick 2–4 pipelines + a goal (or full eval). Run side-by-side. Distributions overlaid; per-metric paired-bootstrap test. *"Pipeline B beats A on `playerRelevantWords` by 18 (p<0.01), tied on diversity, costs 4×."* |
| **Composer** | Assemble a pipeline by clicking roles → impl → model. Save as new pipeline id. |
| **Trace inspector** | Every span clickable. Prompt-in / response-out. Mutator's swap suggestions and what they did to score. Pulled from MLflow when local; in-memory otherwise. |
| **Replay & what-if** | Pull a captured trace, swap one prompt or model, re-run with same seed where possible. Diff. The inner loop of prompt iteration. |
| **Optimizer** | DSPy / TextGrad runner against a pipeline + objective. Watch prompts evolve. Promote optimized prompts behind a flag. (Phase B.) |
| **Player feedback** | Thumbs-up/down on generated boards. Builds the calibration set. |
| **Champion** | Banner: which pipeline serves prod, leaderboard delta, last-promoted timestamp. |

Smart Mode in the player UI = run-the-current-champion. The Lab is how new champions get crowned.

## 7 — Build phasing

This replaces the phasing in `PLAN.md`. Phases are no longer "deterministic → intelligence → preferences" — that was *prerequisite work* (it had to ship for any of this to be possible) but it isn't the AI-engineering work itself.

| Phase | Work |
|---|---|
| **A.0 — Vision** ✅ | This doc + `EVAL_SUITE.md` v2 + `PLAN.md` rewrite |
| **A.1 — Abstractions** ✅ | Role interfaces, Pipeline type, runner, registry. No behavior change. |
| **A.2 — Refactor** ✅ | Today's procedural orchestrator becomes 2 pipelines: `p00-deterministic` + `p01-smart-router`. Tests still pass. |
| **A.3 — Algorithm A** ✅ | SLM-mutator + `p02-slm-mutator`. Bench result: does it beat `p01` on `playerRelevantWords` at matched compute? |
| **A.4 — Bench infra** ✅ | `evals/run-bench.ts` + leaderboard with paired-bootstrap CIs. CI gate. |
| **A.5 — Lab UI** ✅ | Pipeline tab + Bench tab + composer (read-only) + champion indicator. |
| **A.6 — Wire to player** ✅ | Smart Mode runs current champion. |
| **B — Critic & calibration** | SLM judge implementation. Player-rated set scaffolding. ECE / Spearman against humans. |
| **C — Algorithm B** | Evolutionary search with SLM crossover (`p03-evolutionary`). |
| **D — Algorithm C** | Verifier-generator loop (`p04-critic-rerank`). |
| **E — Algorithm G** | SLM-parsed prompt (`p08-parsed-prompt`). Builder prompt becomes functional. |
| **F — Cascade & self-consistency** | (E) and (F). Cheap wins on top of any pipeline. |
| **G — Optimizer** | DSPy / TextGrad against the eval set. Promote optimized prompts behind a flag. |
| **H — Distillation** | Capture traces from heavier pipelines, train tiny task-specific replacements. |
| **I — MCTS (research)** | (D). Ship behind a flag; bench reports cost/quality only. |

A.0 through A.6 are the work *this branch ships*. B onward is the roadmap.

## 8 — Engineering rules

1. **Layer boundaries are sacred.** Pure tools (`generation/`) have no model dependency. Search has no model dependency. Models live in roles; a pipeline binds them.
2. **Pipelines are config, not procedure.** New pipeline = new TS config + maybe new role implementation. Never a new procedural orchestrator.
3. **Bench-or-die.** Any pipeline change runs the eval before merging. CI rejects regressions.
4. **Statistical wins, not eyeball wins.** Paired-bootstrap CI, p<0.05, multi-metric Pareto. Single-run "looks better" is not evidence.
5. **Trace everything.** Every model call, every mutation, every accept/reject is a span. MLflow is the off-the-shelf viewer. The trace is the eval input — replay-with-different-prompt is the inner loop.
6. **No spoilers in narrator output.** The hard rule that today's `EXPLAIN_SYSTEM` enforces remains a contract for any narrator implementation.
7. **Calibration before deployment.** SLM judges and prompt parsers must demonstrate human agreement on a held-out set before being trusted as graders.
8. **One champion at a time.** Production runs one pipeline. Challengers ride along in shadow mode (logged but not surfaced) until promoted.

## See also

- [`PLAN.md`](./PLAN.md) — phase-by-phase build plan (now keyed off this doc)
- [`EVAL_SUITE.md`](./EVAL_SUITE.md) — benchmark spec, metrics, statistical protocol
- [`INTELLIGENT_GENERATION.md`](./INTELLIGENT_GENERATION.md) — current-state walkthrough (will retire once the Lab UI ships)
- [`AGENTIC_VISION.md`](./AGENTIC_VISION.md) — long-horizon target
- [`SERVER_SLM.md`](./SERVER_SLM.md) — server-side SLM trade-off
