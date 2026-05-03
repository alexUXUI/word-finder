# Agentic Vision — the self-improving board generator

PLAN.md is the *build* plan: how the system is shaped today.
AGENTIC_VISION.md is the *asymptote*: what the system becomes once it ships, and how every component is structured so the system gets *measurably* better over time without us writing more code.

The core claim is testable: **at six months out, a system instrumented for evals + traces + feedback + offline prompt optimization will produce demonstrably better boards than the same system without that loop.** Not because the model gets smarter, but because the *recipes, prompts, strategy mix, and budget allocation* are continuously tuned against measurable goals.

---

## What "self-improving" actually means

Three concrete loops, in increasing time horizon:

1. **Per-generation loop (seconds)** — orchestrator inspects tool outputs, reflects, picks the next action. Bounded by budget. This is the agent loop everyone talks about.
2. **Per-session loop (hours)** — recipe memory remembers which (goal × strategy × params) tuples produced high-scoring boards for *this player*. Future generations bias toward those recipes.
3. **Per-cohort loop (weeks)** — captured traces and player feedback signals feed an offline optimizer that tunes prompts, strategy weights, and budget allocations against the eval set. Optimized artifacts ship in the next deploy.

Most projects implement loop 1 and call it agentic. Loops 2 and 3 are where the actual compounding happens. PLAN.md as written ships loops 1 and 2 in Phase 4. This doc says **make Phase 1 the foundation for loop 3 too**, because everything in loop 3 (eval set, trace schema, feedback capture) is cheaper to design in than to retrofit.

---

## The flywheel

```
                    ┌──────────────────────────────────┐
                    │   Eval set (versioned)           │
                    │   {goal, target metrics}*N       │
                    └──────────┬───────────────────────┘
                               │ runs against
                               ▼
       ┌─────────────────────────────────────────────────┐
       │  Generation pipeline                            │
       │  ┌──────────────────────────────────────────┐   │
       │  │ Layer 3: Intelligence (orchestrator)     │   │
       │  │ ↳ tier S/M/L model calls, prompts vN     │   │
       │  └──────────────────────────────────────────┘   │
       │  ┌──────────────────────────────────────────┐   │
       │  │ Layer 2: Search engine (deterministic)   │   │
       │  └──────────────────────────────────────────┘   │
       │  ┌──────────────────────────────────────────┐   │
       │  │ Layer 1: Tools (deterministic, pure)     │   │
       │  └──────────────────────────────────────────┘   │
       └────┬───────────────────────┬────────────────────┘
            │ trace                 │ generated board
            ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐
    │ Trace store     │    │ Player session  │
    │ (offline OK)    │    │ behavioral signals
    └────────┬────────┘    └────────┬────────┘
             │                       │
             └───────┬───────────────┘
                     │ join on generation_id
                     ▼
            ┌─────────────────────┐
            │  Labeled dataset    │
            │  (trace + outcome)  │
            └────────┬────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Offline optimizer (R&D)     │
        │ - prompt versions           │
        │ - strategy weights          │
        │ - budget allocations        │
        │ - bandit posteriors         │
        └────────┬────────────────────┘
                 │ ships
                 ▼
        Updated artifacts deployed
                 │
                 ▼
            (loop closes)
```

Three things to notice:

- **The eval set is the spec.** Every change in the system — code, prompt, model, params — passes or fails the eval set before reaching production.
- **Traces and player signals are joined offline** by `generation_id`. The browser doesn't need to ship the labeling logic.
- **Optimization happens offline.** Heavy compute runs on developer machines or CI. The browser ships only the optimized artifacts (prompt strings, strategy weights, recipe seeds).

---

## Four layers of measurability

Each layer has a concrete schema. None of these are nice-to-have; they're what makes the flywheel exist.

### 1. Eval surface

`docs/EVAL_SUITE.md` will contain a versioned, append-only set of `{goal, target_metrics, weight}` triples. Examples:

```yaml
# eval-suite v1
- id: "default-balanced"
  goal:
    grid_size: 5
    min_word_length: 5
    style: "balanced"
  target:
    p10_player_relevant_words: ">= 50"
    mean_player_relevant_words: ">= 100"
    diversity_recent_window: ">= 0.5"
  weight: 1.0

- id: "rare-letter-chaotic"
  goal:
    style: "chaotic"
    required_letters: ["q", "z"]
    novelty: "high"
  target:
    contains_required_letters: "true"
    mean_player_relevant_words: ">= 70"
  weight: 0.5

- id: "long-word-heavy"
  goal:
    style: "long-word-heavy"
    target_long_words: true
  target:
    p50_max_word_length: ">= 7"
    count_words_length_8_plus: ">= 5"
  weight: 0.7

# ... grows as we discover failure modes
```

The eval is run by `yarn eval`. It generates N boards per goal, computes metrics, asserts thresholds, and writes a structured report. Fails block merges. Promotion of new prompts/models/strategies requires beating the previous version on a weighted-mean metric.

**Failure cases become evals.** When a player flags a board as bad, that goal × board pair is captured. Periodically, the worst-rated cases get promoted to the eval set as regression checks. The eval set is the project's institutional memory of what "bad" looks like.

### 2. Trace surface

Every generation emits a structured trace conforming to OpenTelemetry semantics. TypeScript types:

```ts
interface GenerationTrace {
  trace_id: string;                  // uuid
  generation_id: string;             // joins to player session
  prompt_versions: Record<string, string>;  // {plan: "v3.1.2", reflect: "v2.0.0"}
  model_versions: Record<string, string>;   // {orchestrator: "qwen2.5-0.5b-q4"}
  goal_signature: string;            // hashed goal for dataset partitioning
  spans: Span[];
  outcome: {
    final_score: number;
    final_metrics: BoardScore;
    elapsed_ms: number;
    candidates_evaluated: number;
    model_calls: number;
    estimated_cost_usd: number;       // 0 in browser; useful for offline replay
    budget_exhausted: boolean;
    selected_strategy: string;
  };
  created_at: string;
  client: { browser, webgpu_available, model_load_ms };
}

interface Span {
  span_id: string;
  parent_span_id: string | null;
  name: string;                      // "model.plan", "tool.solve_board", etc
  type: "AGENT" | "CHAIN" | "CHAT_MODEL" | "TOOL" | "RETRIEVER" | "EVALUATION";
  start_ms: number;
  end_ms: number;
  attributes: Record<string, unknown>;
  inputs: unknown;                   // truncated/hashed for large payloads
  outputs: unknown;
  error?: { message, stack };
}
```

Sinks (pluggable):
- **Console** — dev.
- **IndexedDB** — local replay; tests, debugging.
- **OTel HTTP** — to a Cloudflare Worker proxy that batches and forwards to whatever (MLflow Tracking Server, Honeycomb, Tempo, custom backend).

Inputs/outputs are *truncated and hashed* before sinking — never log the dictionary, log `dictionary_hash`. Never log player PII. Trace size budget per generation: ~5 KB.

### 3. Feedback surface

Implicit signals (no UI required):
- `time_to_first_word_ms`
- `total_play_time_ms`
- `words_found_count`
- `words_found_5_plus`
- `did_complete` (≥ X% of solver answers)
- `did_rage_quit` (closed within 5 s, zero words)
- `returned_to_play_within_24h`

Explicit signals (one tap, after some boards):
- `loved_it | skip | meh`
- Optional reason: `too_easy | too_hard | boring_letters | no_long_words`

Both flow into a `PlayerOutcome` joined to the `generation_id` from the trace. Neither blocks gameplay. Anonymized by default; opt-in to richer telemetry.

The labeled dataset `(trace, outcome)` is what the offline optimizer learns from.

### 4. Optimization surface

Three things are tuned, in three different cadences:

**Per-generation (seconds, online)**:
- Strategy selection — contextual bandit over `(goal_signature, strategy_id)` with reward = `final_score`. Thompson sampling. State persists in IndexedDB. Cold-start prior from offline-optimized weights.

**Per-session (hours, online)**:
- Recipe memory — `RecipeStore` indexed by `goal_signature`. New goals trigger lookup; matching recipes seed the search engine. Novelty penalty pushes against repeating the same recipe twice in a row.

**Per-cohort (weeks, offline)**:
- Prompt optimization — DSPy-style. Tooling lives in a `tools/optimizer/` directory or a sister Python repo. Inputs: captured `(trace, outcome)` dataset + eval set. Outputs: new prompt versions + reports showing eval-set delta. Promotion requires non-regression on the weighted-mean eval metric.
- Strategy weight tuning — same dataset, same eval set, but tuning the prior over strategies and budget allocations.
- Model selection — periodically benchmark new candidate models (Qwen2.5-1.5B, Phi-3-mini, etc.) against the eval set. Promote when a new model wins at acceptable size/latency.

**Critical invariant**: the browser only ever ships *artifacts* — final prompt strings, final strategy weights, final budget allocations. It does not ship the optimizer. The optimizer is R&D infrastructure, not runtime.

---

## Intelligence tiers

Models are not commodities. Each generation uses *several* models with very different cost/latency profiles. Pretending they're all the same is how UX gets killed by latency.

| Tier | Model class | Latency budget | Use cases |
| --- | --- | --- | --- |
| **XS** | Hand-coded heuristic / regex / rule | < 1 ms | "Does this goal mention rare letters?" Goal validation. Default fallbacks. |
| **S** | ONNX classifier / embedder, ~10–50 MB | 5–20 ms | Accept/reject candidate. Goal-signature embedding. Recipe lookup. *Hot* path during search. |
| **M** | Quantized small LLM (Qwen2.5-0.5B q4), ~300 MB | 200–800 ms | Goal parsing. Strategy selection. Reflection between candidates. *Cold* path between search rounds. |
| **L** | Quantized mid LLM (Phi-3-mini q4), ~2 GB | 1–3 s | Final explanation. "Why this board?" Run once at the end. Optional, or behind a toggle for users who opt into "show your work." |

A typical generation:
- **0–1× L call**: explanation at the end. Optional.
- **3–6× M calls**: parse goal, pick strategy, mid-search reflection, final acceptance.
- **0–N× S calls**: every candidate scored gets a fast classifier check.
- **K× XS rules**: validation, fallbacks, sanity checks throughout.

**Hard rule**: nothing in Layer 1 or Layer 2 calls anything above XS. The search loop is allowed to call S only because S is fast and stateless. M calls happen *between* search rounds, never inside. L is end-of-generation only.

---

## Offline / online split

The browser is the *runtime*. It must:
- Generate boards.
- Emit traces.
- Read deployed artifacts (prompts, weights).
- Run a local bandit and recipe store (per-user state).

The browser must not:
- Run prompt optimization.
- Aggregate cross-user data.
- Train models.
- Run evals against the full set during normal gameplay.

The R&D side (developer machines, CI) does the heavy lifting:
- `yarn eval` — run the eval suite with one or more strategy/prompt/model variants. Outputs a comparable report.
- `yarn optimize:prompts` — DSPy-style search over prompt variants against the labeled dataset. Outputs new versioned prompt artifacts.
- `yarn optimize:strategies` — tune strategy weights and budget allocations. Outputs new versioned config.
- `yarn benchmark:model <model-id>` — sweep a candidate model against the eval set, reporting size/latency/quality.

Every R&D job emits its own trace into a separate sink (likely the same MLflow proxy, different namespace). All optimization is itself observable.

---

## Phasing, revisited

PLAN.md as written ships eval/trace in Phase 5. **This was wrong.** Without traces, every Phase 1+ change is guesswork. I'm revising:

| Old phase | New positioning |
| --- | --- |
| Phase 1: deterministic baseline | Same. Plus: trace skeleton (console adapter, in-memory sink). Plus: eval suite v1 with 3-4 goals. `yarn eval` runs against the deterministic search engine, produces report. |
| Phase 2: intelligence layer | Same. Plus: trace gains model-call spans. Eval suite gains intelligence-layer-specific evals (does goal-parsing succeed? does strategy choice correlate with goal?). MLflow / OTel-HTTP sink lights up. |
| Phase 3: user preferences | Same. Plus: feedback capture (implicit + explicit) wires through. Player outcomes start landing in the labeled dataset. |
| Phase 4: recipe memory | Same. Plus: contextual bandit over strategies. Cold-start prior from offline-tuned weights. |
| Phase 5: tracing | Mostly already done by here. Becomes "trace pipeline polish" + dashboards. |
| Phase 6: optimization | **New phase.** Offline prompt + strategy weight tuning. Model selection benchmark. CI step that fails on regression. |
| Phase 7: polish | Was Phase 6. UI for "why this board," diagnostics. |

The rule of thumb: **a phase ships only when its eval-set delta is positive.** Otherwise we're guessing.

---

## Failure modes & guardrails

| Failure | Detection | Guardrail |
| --- | --- | --- |
| Model drift — new model version produces worse boards | Eval set regression | Promotion gate: new model must beat old on weighted eval metric. |
| Prompt regression — new prompt makes orchestrator loop forever | Eval set timeout / candidates_evaluated explosion | Hard budget per goal; offline test for budget compliance before promotion. |
| Eval gaming — system optimizes the metric, not the experience | Player feedback diverges from eval scores | Cohort analysis comparing eval-predicted score vs player-explicit signal. Update eval set when divergence persists. |
| Cost runaway — model load too slow / inference too long | Telemetry on `model_load_ms`, `mean_inference_ms` | Per-tier latency budgets enforced; degrade gracefully (drop M to XS) when over budget. |
| Recipe staleness — old recipes win bandit forever | Diversity penalty in bandit reward, exploration floor | Floor minimum exploration rate (~10%). Decay recipe weights over time. |
| Player privacy concerns | Telemetry opt-out from day one | All session telemetry is opt-in; only fully anonymized aggregates leave the device. |
| Trace bloat — traces too large to store | Trace size budget per generation | 5 KB cap; truncate/hash large fields; sample non-anomaly traces at 10%. |
| Cold-start (no data yet) | First N generations have no recipes / weak bandit posterior | Ship sensible defaults from offline pre-training; mark cold-start visibly in dev mode; recipes become useful by generation ~50. |

---

## What this means for the next work session

We have Phase 0 numbers and a draft PR open. Before Phase 1 starts, this doc should be reviewed. Specifically:

1. **Promote the eval suite to Phase 1.** Concretely, write `docs/EVAL_SUITE.md` with v1 of the goals and target thresholds. Add `yarn eval` running against the deterministic search engine.
2. **Promote the trace schema to Phase 1.** Concretely, define the TypeScript types now and have the search engine emit (console-adapter) traces from day one. MLflow proxy sink can wait, but the *shape* must be fixed.
3. **Lock the intelligence tiers.** Write the rule into the code (Layer 1+2 may not import `LocalModelProvider`; CI rule). Make the budgets explicit per tier.
4. **Plan the optimizer harness now.** Don't build it yet. But the *shape* of `(trace, outcome) → optimizer → artifact` should be sketched so Phase 1's trace + Phase 3's feedback capture are compatible with the optimizer that ships in Phase 6.

If you agree with this framing, I'll:
- Update PLAN.md to absorb these changes (eval/trace promoted to Phase 1, new Phase 6 = optimization).
- Write `docs/EVAL_SUITE.md` v0 with 3-4 starter goals derived from Phase 0 findings.
- Write `src/intelligence/trace/types.ts` with the schema.
- Push to the same draft PR.

That sets up Phase 1 to be measurable and self-improving from the first commit, instead of "we'll add tracing later."

---

## The asymptotic claim, restated

Six months in:
- The eval suite has ~50 goals derived from real player frustrations and developer hypotheses.
- Captured `(trace, outcome)` dataset has tens of thousands of generations.
- Three prompt versions have been promoted via offline optimization, each beating the previous on the weighted eval metric.
- Strategy weights have been tuned twice; one underperforming strategy was retired.
- One model upgrade has shipped (e.g., Qwen2.5-0.5B → Phi-3-mini) gated on eval delta.
- Player-facing diversity score has trended up; "rage quit within 5 s" rate has trended down.
- New developers can extend the system by writing a new strategy, registering it, and letting the bandit + offline optimizer figure out where it fits.

None of that requires us to be smarter as the codebase ages. It requires the loop to exist from day one. That's what this doc is asking for.
