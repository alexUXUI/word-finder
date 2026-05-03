# Intelligent Board Generation — Plan

Working document. Future sessions resume here. Push back on anything below before code lands; once a phase ships, decisions become hard to reverse.

> Companion doc: [`AGENTIC_VISION.md`](./AGENTIC_VISION.md) — what the system asymptotes to once shipped (eval-as-spec, traces, feedback loop, offline prompt optimization). PLAN.md is the *build* plan; AGENTIC_VISION.md is the *target state*. The phasing here was updated to absorb the vision doc — see Phase 1 changes below.

## The real problem

The existing `randomBoard()` in `src/components/boggle/logic/board.ts` produces decent total word counts but **boards feel the same**. Word families repeat, vowel/consonant placement follows a narrow zip-pattern, and the "unpopular consonant" pick is barely random. Players notice.

So the optimization target is two-dimensional, not one:
- **maximize** unique 5+ letter words on each board
- **maximize** distance from recent boards (diversity)

## Where intelligence actually helps

We're going to push back on the framing of "an SLM generates the board." Search through a discrete space (pick 25 letters that maximize a score) is what deterministic algorithms — hill climbing, simulated annealing, evolutionary search — exist for. SLMs can't beat them at search.

Where SLMs **do** add value:

| Task | Best handled by |
| --- | --- |
| Search through millions of candidate boards | Deterministic algorithm (hill climb / annealing / evolutionary) |
| Score a board | Pure function |
| Decide *which strategy* to try given a goal | **SLM** (planning) |
| Translate fuzzy preferences ("rare-letter chaotic board") into structured params | **SLM** (NL → struct) |
| "Should I accept this candidate or keep searching?" | Tiny classifier or rule (cheap) |
| Explain *why* this board was chosen | **SLM** (language) |
| Self-tune which strategy/params worked | Recipe memory + bandit, not the model |

The SLM is the **conductor**, not the orchestra.

## Architecture (three layers, hard boundaries)

```
┌──────────────────────────────────────────────┐
│  Layer 3 — Intelligence (SLM orchestrator)   │
│  parse preferences · pick strategy · reflect │
└──────────────────┬───────────────────────────┘
                   │ tool calls (typed)
┌──────────────────▼───────────────────────────┐
│  Layer 2 — Search engine                     │
│  budget · diversity tracking · candidate pool│
│  hill climb / annealing / evolutionary       │
└──────────────────┬───────────────────────────┘
                   │ pure functions
┌──────────────────▼───────────────────────────┐
│  Layer 1 — Tools (deterministic, pure)       │
│  generate · solve · score · mutate · validate│
└──────────────────────────────────────────────┘

Cross-cutting: GenerationTracer (console / in-memory / MLflow adapter)
Cross-cutting: RecipeStore (IndexedDB) — what worked for which goals
```

**Boundary rule**: Layer 1 has *no* model dependency, ever. Layer 2 has *no* model dependency either — pure search. Only Layer 3 talks to the SLM. Keeps testing cheap, replacement easy, and CI deterministic without model downloads.

Everything Layer 2+ runs in a **Web Worker** so the UI never blocks.

## Phases

Incremental shipping. Each phase ends in a merge-ready PR.

### Phase 0 — Spike & measure (1 session, in flight)

Cheap to do, expensive to skip. Numbers shape every architecture decision.

**Deliverables**
- Benchmark current `solve()` candidates/sec on a 5×5 with the production English dictionary.
- Distribution of total words and player-relevant 5+ letter words across 100 random boards.
- Pairwise board similarity (Jaccard on word sets, Levenshtein on flat string) to set the diversity baseline.
- Research into browser-local model options (WebLLM, Transformers.js, ONNX). Document model sizes, inference latency expectations, WebGPU coverage.
- `docs/spike-findings.md` with concrete recommendations for Phase 1 budget and Phase 2 model choice.

**Acceptance**: numbers in hand, model candidate selected, draft PR opened so user can react before Phase 1 commits to a budget.

### Phase 1 — Deterministic baseline + eval/trace foundation (5–7 sessions)

This alone fixes ~70–80% of the diversity problem **and** establishes the measurability that every later phase depends on. Per AGENTIC_VISION.md, eval/trace cannot be deferred — without them, every later change is guesswork.

**Deterministic deliverables**
- `BoardStrategy` interface; refactor existing generator into one named strategy.
- New strategies:
  - `frequency-weighted` — sample from English letter frequencies, parameterized.
  - `n-gram` — bias toward common bigram/trigram adjacencies.
  - `seed-word` — embed selected dictionary words on legal Boggle paths, fill rest.
  - `dice-shuffle` — Boggle-style fixed dice faces, shuffled positions.
- **Fix the english vowel pool** — the Phase 0 finding. Replace `['e','e','e','e','e','a','a','a','i','i','s','s']` with frequency-weighted real vowels (a/e/i/o/u). One-line bug fix that solves most of the perceived sameness.
- `BoardScorer` returning multi-dimensional score (totalWords, playableWords, wordsByLength, averageWordLength, maxWordLength, uniqueLetters, vowelRatio, vowelInventoryEntropy, prefixDiversity, similarityToRecent, finalScore).
- `SearchEngine` running candidates with budget (max attempts, max ms), tracking best, applying diversity penalty against recent boards.
- Web Worker hosting the engine.
- Fix trie singleton bug in `solve()` (allocates fresh trie per call or accepts a pre-built one).

**Eval & trace deliverables (new — promoted from old Phase 5)**
- `docs/EVAL_SUITE.md` v1 with 3–4 starter goals + target metrics (default-balanced, rare-letter-chaotic, long-word-heavy, classic).
- `yarn eval` script that runs each goal N times against the deterministic search engine, computes metrics, asserts thresholds, writes a structured report. Failing thresholds block merges.
- `src/intelligence/trace/types.ts` — final `GenerationTrace` and `Span` schemas (per AGENTIC_VISION.md §4 Trace Surface).
- `GenerationTracer` interface with `console` and `in-memory` adapters wired into the search engine. Every generation emits a trace from day one.
- Tests across all of the above.

**Acceptance**: eval suite passes (mean 5+ words ≥ 100, p10 ≥ 50, vowel-inventory entropy >> 0). Every generation produces a parseable trace. No regressions in existing unit / e2e suites.

### Phase 2 — Intelligence layer (3–5 sessions)

**Deliverables**
- `LocalModelProvider` interface (`generate`, `supportsJson`, `supportsToolCalling`, etc.).
- `MockProvider` — deterministic, used by CI. Scriptable to simulate "switch strategy after low score", "stop when threshold met", "return malformed tool call".
- `WebLLMProvider` (or whichever Phase 0 picks) — real on-device. Lazy-loaded, with download progress UI.
- Tool registry + arg validator. Orchestrator only calls registered tools.
- Orchestrator loop: summarize state → ask model for next action → validate → execute tool → score → continue until budget / threshold.
- Three modes: `fast` (few iterations), `balanced` (default), `deep` (many iterations).

**Acceptance**: orchestrator drives strategy selection on top of Phase 1; CI passes with mock provider; real model produces explanations that pass eyeball review.

### Phase 3 — User preferences (2–3 sessions)

**Deliverables**
- Preference UI (preferred/required/avoided letters, style, difficulty, novelty).
- NL preference description → structured `BoardGenerationGoal` (a model task).
- Goal threaded through orchestrator → search engine → strategy params.
- e2e: "I want a chaotic rare-letter board with 8+ letter words" actually produces one.

### Phase 4 — Recipe memory (2 sessions)

**Deliverables**
- IndexedDB-backed `RecipeStore` keyed on goal-signature.
- Lookup biases new generation toward params that worked for similar past goals.
- Novelty penalty against recent recipes to avoid re-using the exact same recipe twice in a row.

### Phase 5 — Trace pipeline polish (1–2 sessions)

The tracer skeleton ships in Phase 1. Phase 5 is the production sink + dashboards.

**Deliverables**
- `mlflow` adapter — small Cloudflare Worker proxy that batches OTel-shaped span exports and forwards to an MLflow Tracking Server (or any OTel collector you point at).
- IndexedDB sink for offline replay.
- Trace viewer in the dev panel; per-generation drill-down.
- Sampling policy (10% for non-anomaly traces, 100% for evals and errors).

### Phase 6 — Offline optimization (3–5 sessions)

The capstone of the self-improving loop. R&D-side, not browser-side.

**Deliverables**
- `tools/optimizer/` directory (or sister Python repo if DSPy-based).
- `yarn optimize:prompts` — prompt-version search over the labeled `(trace, outcome)` dataset, against the eval set. Outputs new versioned prompt artifacts + a comparison report.
- `yarn optimize:strategies` — tunes strategy weights and budget allocations against the eval set.
- `yarn benchmark:model <model-id>` — sweeps a candidate model against the eval set; reports size/latency/quality.
- CI step that fails when a promoted prompt/model regresses on the weighted eval metric.

### Phase 7 — Polish (open-ended)

- "Why this board?" panel for players.
- Generation diagnostics in dev mode.
- Production telemetry on diversity score distribution.
- Cohort analysis comparing eval-predicted scores vs explicit player feedback.

## Risks tracked openly

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| WebLLM models are 500MB–1.5GB | Big download for a Boggle game; mobile data plans | Phase 0 measures real perceived load time. Lazy-load only when "advanced generation" is opened. Server-side fallback path designed in from the start. |
| WebGPU coverage uneven | Mobile Safari, older devices | Graceful no-WebGPU path: smaller ONNX classifier, or server inference, or skip the intelligence layer and use deterministic-only mode. |
| Solver throughput | If `solve()` does <10 candidates/sec, search budget shrinks | Phase 0 measures. If slow, profile and optimize before Phase 1 search engine. Candidate optimization: WASM solver (already built but unused). |
| Diversity metric definition | Many valid choices | Phase 0 picks one and documents the choice. Default: Jaccard on player-relevant word set, weighted by recency. |
| MLflow in browser doesn't exist | Promised in original draft; not feasible | Tracer is an *abstraction*. MLflow adapter is a Cloudflare Worker proxy. Optional, doesn't gate gameplay. |
| Real-model non-determinism in tests | Flaky CI | `MockProvider` is the default for CI. Real model is opt-in for dev / e2e smoke. |
| Self-optimizing prompts | Easy to over-engineer | Deferred. Recipes give 80% of the value. Re-evaluate after Phase 4. |
| Trie singleton bug in `solve()` | Will leak state across hundreds of candidate calls | Fix in Phase 1 (allocate fresh trie or accept pre-built). |

## Engineering rules for this work

1. Branch: `feat/intelligent-board-generation`. PR per phase, draft until phase acceptance criteria met.
2. Layer 1 stays pure. Layer 2 stays model-free. Only Layer 3 talks to SLMs.
3. CI uses `MockProvider`. Never gate CI on a real model download.
4. Web Worker hosts Layer 2+ so the UI never blocks.
5. Playwright MCP validates each phase's user-visible behavior.
6. Tracer instrumented from Phase 1 forward (console adapter is fine in early phases).
7. Each phase ships behind a feature flag or "advanced generation" toggle until the whole system is good enough to be the default.

## Open questions to resolve in Phase 0

1. **Solver throughput**: candidates/sec on a 5×5 with the production dict?
2. **Current diversity baseline**: pairwise Jaccard mean / std over 100 boards?
3. **Smallest WebLLM model with reliable JSON / tool calling**?
4. **WebGPU support detection**: how to detect early and route to fallback?
5. **Dictionary loading**: cache strategy for offline / repeat visits?

Phase 0 fills these in. Phase 1 design decisions defer until then.
