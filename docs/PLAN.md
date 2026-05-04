# Word Finder build plan

> Source-of-truth for AI engineering work: [`AI_ENGINEERING.md`](./AI_ENGINEERING.md). This doc is the *phase-by-phase* execution view; AI_ENGINEERING describes pipelines, roles, algorithms, and the bench protocol.
>
> Companion docs:
>
> - [`EVAL_SUITE.md`](./EVAL_SUITE.md) v2 — the bench spec
> - [`AGENTIC_VISION.md`](./AGENTIC_VISION.md) — long-horizon target state
> - [`SERVER_SLM.md`](./SERVER_SLM.md) — server-side SLM cost/migration
> - [`INTELLIGENT_GENERATION.md`](./INTELLIGENT_GENERATION.md) — current-state walkthrough (will retire when Lab UI lands)

## Status

**Foundation (shipped to `main`):**

- ✅ Phase 0 — spike + baselines (vowel pool fix, dictionary scan, candidates/sec measurements)
- ✅ Phase 1 — deterministic baseline + eval/trace foundation: `BoardStrategy` registry, `BoardScorer`, `SearchEngine` with retry loop, MLflow trace pipeline, `yarn eval` v1 gating CI
- ✅ Phase 2 — intelligence layer: `LocalModelProvider` interface, on-device SLMs (Transformers.js), procedural orchestrator with `pick_strategy → search → explain`, MLflow CHAT_MODEL spans, dev test pages
- ✅ Phase 2.0d — player-facing Smart Mode toggle, dismissable banner, narration log, search progress, no-spoiler explanation, version footer

**On `feat/server-side-slm` (this branch, pre-merge):**

- ✅ Mobile compatibility — UA-based device-tier picker, `/api/llm` Pages Function + Workers AI, 5-tier model registry with localStorage override
- ✅ Player Min Words input — drives `goal.minPlayerRelevantWords`, search budget scales with target, honest "floor not met" warning, "best of K" tracking
- ✅ Board Builder side panel — prompt → batch runs → favorites (will be replaced by the Pipeline Lab in A.5)

**The above is the foundation. The actual AI engineering work begins now.**

## Phase A — pipelines, algorithms, benchmarks (this branch)

This phase reframes board generation from *"a procedural orchestrator with an SLM bolted on"* to *"a benchmarked portfolio of composable pipelines."* See [`AI_ENGINEERING.md`](./AI_ENGINEERING.md) §1–6 for the rationale.

| Step | Deliverables | Acceptance |
|---|---|---|
| **A.0 — Vision docs** | `AI_ENGINEERING.md`, `EVAL_SUITE.md` v2, this PLAN rewrite | Committed |
| **A.1 — Abstractions** | `intelligence/roles/` (7 role interfaces), `intelligence/pipeline/` (Pipeline type, runner, registry). No behavior change yet. | Build green; existing UI flow works through the new runner. |
| **A.2 — Refactor** | `pipelines/p00-deterministic.ts` + `pipelines/p01-smart-router.ts`. The procedural orchestrator becomes two configs over the new role interfaces. | Player Smart Mode produces identical traces (semantically) to pre-refactor. `yarn bench --pipeline=p01` matches pre-refactor numbers. |
| **A.3 — Algorithm A: SLM-mutator** | `roles/mutator/slm-swap.ts` + `roles/mutator/random-swap.ts` + `pipelines/p02-slm-mutator.ts` + versioned mutator prompt | `p02` either dominates `p01` on `playerRelevantWords` at matched compute, OR the bench tells us it doesn't and we know why. |
| **A.4 — Bench infra** | `evals/run-bench.ts` + `leaderboard.ts` (paired-bootstrap CIs, Pareto plot) + `goals.yaml` v2 starter set + `yarn bench` script + CI gate | `yarn bench` produces a leaderboard. PR comment shows delta. |
| **A.5 — Pipeline Lab UI** | `lab/PipelineLab.tsx` replaces `builder/BoardBuilder.tsx`. Pipeline cards, side-by-side Bench tab, composer (read-only first cut), champion indicator, trace links. | Lab loads; pipeline cards show real eval scores; Bench tab runs 2 pipelines on a goal and shows distribution overlay + per-metric CI. |
| **A.6 — Wire to player** | Smart Mode in `Controls.tsx` runs the current champion (`pipelineRegistry.champion()`) instead of constructing a procedural orchestrator. | Player UI behaves the same with `champion=p01`; switching champion to `p02` changes behavior in observably-better ways. |

## Phase B — Critic & calibration

| Step | Deliverables |
|---|---|
| **B.1 — SLM judge** | `roles/critic/slm-judge.ts` — rates board-vs-goal-description on 0..1 |
| **B.2 — Player-rated set** | Player Feedback tab in Lab. Thumbs up/down on generated boards → `player-rated.parquet`. Internal rating-session script for held-out boards. |
| **B.3 — Calibration metrics** | `bench` reports judge ECE, Spearman, agreement vs `player-rated`. Judge demotion when below threshold. |
| **B.4 — Critic-and-generator pipeline** | `pipelines/p04-critic-rerank.ts` — generator emits 10, judge reranks, take top. Bench against `p01`. |

## Phase C — Algorithm B: Evolutionary search with SLM crossover

| Step | Deliverables |
|---|---|
| **C.1 — Crossover role** | `roles/mutator/slm-crossover.ts` — operates on parent pair, returns child boards |
| **C.2 — Evolutionary pipeline** | `pipelines/p03-evolutionary.ts` — pop=50, top-K, crossover + mutator, N generations |
| **C.3 — Bench against matched compute** | Pareto question: does `p03` dominate `p02` on cost-vs-quality? |

## Phase D — Algorithm G: SLM-parsed prompt → structured goal

| Step | Deliverables |
|---|---|
| **D.1 — Parser role** | `roles/prompt-parser/slm-parser.ts` — free-form NL → structured `BoardGenerationGoal` fields |
| **D.2 — Eval set** | `evals/prompts.yaml` — 20 prompts with ground-truth goal fields. F1 reported. |
| **D.3 — Wire into pipelines** | `p05-parsed-prompt-mutator.ts` — chains D.1 in front of A. Lab Builder prompt becomes functional. |

## Phase E — Cascade routing & self-consistency

| Step | Deliverables |
|---|---|
| **E.1 — Cascade router** | `roles/strategy-router/cascade.ts` — try 135M → escalate to 360M → escalate to 0.5B based on confidence |
| **E.2 — Self-consistency** | `roles/strategy-router/self-consistent.ts` — N votes at T=0.7, majority |
| **E.3 — Bench all combinations** | Cost vs quality. Cascade at 135M baseline should match 0.5B-only quality at 1/4 the cost. |

## Phase F — Optimizer (DSPy / TextGrad)

| Step | Deliverables |
|---|---|
| **F.1 — Trace export** | MLflow → DSPy-compatible (prompt, response, score) tuples |
| **F.2 — Prompt optimization runner** | `tools/optimizer/optimize.py`. Takes (pipeline, eval objective), evolves prompts, writes versioned prompt artifacts. |
| **F.3 — Lab integration** | Optimizer tab. Watch prompts evolve. Promote optimized prompts behind a flag. CI bench validates the promotion. |

## Phase G — Distillation

| Step | Deliverables |
|---|---|
| **G.1 — Trace → training data** | Pipeline output → fine-tune dataset for any role |
| **G.2 — Tiny role-specific replacements** | Distill `slm-router`, `slm-mutator`, `slm-judge` into 135M task-specific models. Drop production cost / latency. |
| **G.3 — Promotion** | Distilled models replace heavier ones once their bench delta is within tolerance at lower cost. |

## Phase H — MCTS over partial boards (research)

| Step | Deliverables |
|---|---|
| **H.1 — Letter-policy role** | `roles/candidate-generator/slm-letter-policy.ts` — SLM proposes next letter given partial board + goal |
| **H.2 — MCTS pipeline** | `pipelines/p06-mcts.ts` — UCB on rollout quality |
| **H.3 — Bench cost/quality** | Likely high quality at 10×+ compute. Ship behind a flag; not a default champion. |

## Phase I — Self-hosted Container (per `SERVER_SLM.md`)

| Step | Deliverables |
|---|---|
| **I.1 — Container** | Cloudflare Container with `llama.cpp` + Llama-3.1-8B-q4 |
| **I.2 — Pages Function flag** | `LLM_UPSTREAM=container` flips `/api/llm` to the container; `workers-ai` keeps the existing path |
| **I.3 — Cost regression test** | Bench reports cost-per-board for both upstreams; we choose based on traffic. |

## Engineering rules

1. **Pipelines are config, not procedure.** Adding an algorithm = new TS config (+ maybe new role implementation), never a new procedural orchestrator.
2. **Layer boundaries are sacred.** `generation/` (Layer 1) and `search` (Layer 2) have no model dependency. Models live in roles; pipelines bind them.
3. **Bench-or-die.** No pipeline change merges without a bench run + leaderboard delta in the PR.
4. **Statistical wins, not eyeball wins.** Paired-bootstrap CIs, Pareto frontier, multi-metric. Single-board "looks better" is not evidence.
5. **One champion at a time** in production. Challengers ride along in shadow mode (logged but not surfaced) until promoted.
6. **Trace everything.** Every model call, every mutation, every accept/reject is a span. Replay-with-different-prompt is the inner loop.
7. **No spoilers in narrator output.** The hard rule applies to every narrator implementation.
8. **CI uses MockProvider.** Real model calls are gated behind `BENCH_USE_REAL_MODEL=1` for nightly / on-demand.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Bench latency | Running 9 pipelines × 25 goals × 20 boards = 4500 generations × 5s = ~6h | Tiered runs: `quick` (3 goals × 5 boards), `full` (nightly), `shadow` (prod traffic). CI uses quick. |
| SLM judge misalignment | Subjective metric the judge alone defines is meaningless | `player-rated.parquet` is the ground truth; judge ECE / Spearman gated. |
| Pipeline explosion | 100 configs become unmanageable | Hash-keyed registry; old configs retire when dominated for 3 consecutive bench runs. |
| Refactor regressions | A.2 must keep current behavior | A.2 acceptance is "p01 matches pre-refactor numbers within noise." |
| MCTS / evolutionary cost | Far higher per-board cost | Pareto frontier shows them; champion picker chooses based on policy (cost-aware). |

## Open questions

1. **Where to store `player-rated.parquet`** — Cloudflare R2? GitHub LFS? Defer; v0 in IndexedDB.
2. **Bench compute budget on CI** — quick suite must be <2 min; figure out what fits.
3. **Lab UI persistence** — pipeline configs as TS files (refactorable) vs JSON in localStorage (player-editable). Probably both, with TS as canonical.
4. **Shadow mode protocol** — how to log challenger results without affecting the player. Log to MLflow under `challenger_id` tag; surface in Lab.
