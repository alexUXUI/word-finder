# Phase 0 spike findings

Run on 2026-05-03. Source: `tests/bench/baseline.test.ts`. Raw numbers in `docs/.benchmark-baseline.json`.

## Headline finding: the boards aren't random — they're structurally identical

The `englishVowels` array in `src/components/boggle/logic/board.ts` contains **only `e/a/i`** plus two stray `'s'` characters that aren't vowels at all:

```ts
export const englishVowels = ['e','e','e','e','e','a','a','a','i','i','s','s'];
```

Combined with the `zip(vowels, consonants)` placement, every English board produced by the current generator has, deterministically:

- exactly **5 e's, 3 a's, 2 i's** (10 actual vowels)
- exactly **2 s's** (the typo'd "vowels")
- 12 of the 13 `englishConsonants` (random one dropped)
- exactly 1 letter from `englishUnpopularConsonants` (j/k/q/v/x/y/z)
- **never an `o`, never a `u`**

Across our 100-board sample: 100% had exactly 10 vowels, 0% contained `o` or `u`. Entire word families (`ought`, `house`, `country`, `round`, `you`, `out`, `your`, `would`) are unreachable from any generated board.

This is the structural sameness the player feels. The Jaccard metric on word sets misses it because the *specific* words differ (different consonant placements give different paths) — but the *shape* of the word inventory is the same every time.

**Fix is one line** in Phase 1: rebuild `englishVowels` to be actual vowels with realistic English frequency weights, and stop hardcoding the 12-vowels-then-12-consonants zip pattern.

## Solver throughput

Measured on this machine (Apple M1, Node 20, in-process, no WASM solver):

| Metric | Value |
| --- | --- |
| Mean solve time | **66.4 ms** |
| p10 / p90 | 51.8 / 83.3 ms |
| Std. dev. | 11.9 ms |
| Candidates / second | **~15** |
| Generation cost | 0.02 ms (negligible) |

**Implication for Phase 1 search budget**: a 10-second budget per board lets us evaluate ~150 candidates, which is plenty for a hill-climb / annealing loop over a 5×5 grid. A 5-second budget gives ~75 candidates — workable. A 1-second budget gives ~15, which is a hard stretch for non-trivial search.

The Rust/WASM solver in `src/components/boggle/boggle-solver/` is built but not wired into runtime. Likely 5–10× faster. Worth measuring if Phase 1's search budget needs more headroom; otherwise the JS solver is fine for now.

**Bug to fix in Phase 1**: `solve()` uses a module-level singleton trie that accumulates words across calls. The benchmark resets `trie.root` between calls; production code currently does not. Same dictionary added repeatedly is idempotent so it's not a *correctness* bug today, but it'd block running solve() with different dictionaries (multilingual play, custom dictionaries) and it leaks memory on every call. Allocate a fresh trie per `solve()`, or accept a pre-built one.

## Word-count baseline

Across 100 boards:

| | Total words | 5+ letter words (player-relevant) |
| --- | ---: | ---: |
| Mean | 299 | **77** |
| Median | 298 | 73 |
| Min | 165 | 14 |
| Max | 508 | 189 |
| p10 | 215 | 34 |
| p90 | 378 | 115 |
| Std. dev. | 67 | 34 |

Phase 1 target: **mean 5+ letter words ≥ 100, p10 ≥ 50, max ≥ 200**. Defensible jump from current numbers, achievable by fixing the vowel pool + adding a search engine that picks the best of N candidates.

## Diversity baseline

| Metric | Mean | Min | Max |
| --- | ---: | ---: | ---: |
| Jaccard on 5+ word sets (4,950 pairs) | **0.016** | 0 | 0.135 |
| Levenshtein on flat board string (4,950 pairs) | **21.11** / 25 | 16 | 25 |

Misleading at first glance — Jaccard 0.016 means *specific* word overlap is tiny, and Levenshtein 21/25 means *flat-string* edit distance is high. By those metrics the boards are very different.

But that's the wrong question. Players don't experience word-set Jaccard; they experience *board feel*. The pattern-level diversity (vowel inventory, vowel ratio, letter family distribution) is **zero**. The extended bench captures this directly:

| Structural metric | Value | What it means |
| --- | ---: | --- |
| `distinctVowelMultisets` | **1** | Across 100 boards there is exactly one vowel multiset. Same vowels every time. |
| `vowelMultisetEntropyBits` | **0.000** | Zero entropy. Maximally predictable. |
| `vowelCount.stdDev` | **0.000** | Every board has *exactly* 10 vowels. No variance. |
| `letterCoverage` | **24/26** | Two letters never appear in any board: `o` and `u`. |
| `bigramCoverage` | **255/351** | 27% of possible letter-pair adjacencies are unreachable across the whole sample. |

Phase 1's vowel-pool fix moves all five of these. Phase 1 acceptance asserts on each.

**Phase 1 will track**:
- Jaccard on player-relevant word set (carry forward from baseline)
- Vowel-inventory entropy across boards (counts the number of distinct e/a/i/o/u patterns over a sample)
- Player-relevant prefix/suffix family distribution
- Recent-board similarity penalty applied during search

The single-board final score should be a weighted combination of: word count (5+), word-length spread, prefix diversity, and similarity penalty against a sliding window of recently produced boards.

## Browser-local model options

Quick pass for Phase 2 model choice. None of these is locked in — Phase 2 will ship `MockProvider` first and only wire a real model once the orchestrator is stable.

| Option | Smallest practical | Bytes (q4) | Strengths | Concerns |
| --- | --- | --- | --- | --- |
| **WebLLM** (`@mlc-ai/web-llm`) | Llama-3.2-1B-Instruct | ~700 MB | Mature, OpenAI-compatible API, JSON mode, streaming, growing tool-calling support. WebGPU-only acceleration. | Big download. Tool calling still maturing. WebGPU coverage uneven on mobile. |
| **Transformers.js** | Phi-2 / Qwen2-0.5B q4 | 200–500 MB | More flexible — text gen, classifiers, embeddings. WebGPU **and** WASM fallback. Good ecosystem. | Smaller models = less reliable structured output. No first-class tool calling. |
| **ONNX Runtime Web** | Distilled classifiers ~50 MB | 50–200 MB | Fast, small, great for accept/reject classifiers and reranking. | Not for generation. Need to pair with one of the above for the orchestrator role. |

**Tentative Phase 2 choice**: **Transformers.js with Qwen2.5-0.5B-Instruct** for the orchestrator (preference parsing + strategy planning + reflection), with **ONNX classifier** for the hot accept/reject decisions during search. Rationale:

- 0.5B q4 model is ~300 MB — half the WebLLM minimum, much friendlier first-load.
- WASM fallback means it works without WebGPU (slower, but works).
- Our model tasks are small focused JSON outputs ("which strategy?" "should we accept this?") that 0.5B handles well; we don't need 1B+ reasoning.
- ONNX classifier for accept/reject moves the hot path off the LLM entirely.

If 0.5B proves too weak in early Phase 2 testing, escalate to Phi-3-mini (~2 GB) or WebLLM Llama-3.2-1B.

**WebGPU detection / fallback strategy**: at app startup, probe `navigator.gpu` and the device's adapter limits. Three tiers:
- **WebGPU available**: full intelligence layer with on-device model.
- **WebGPU unavailable, WASM workable**: same model, slower; degraded UX warning.
- **Neither feasible** (low-RAM mobile, network too slow to download): fall back to deterministic-only generation (Phase 1 alone is the product).

## Recommendations for Phase 1

1. **Replace `englishVowels`** with a real-vowel pool (`a/e/i/o/u`) sampled by English frequency. Drop the deterministic zip pattern.
2. **Build the strategy abstraction** (`frequency-weighted`, `n-gram`, `seed-word`, `dice-shuffle`) so the search engine can pick from multiple distributions instead of one.
3. **Fix the trie singleton** in `solve()` so we can run hundreds of solves per board generation safely.
4. **Add a multi-dimensional `BoardScorer`** that includes a recent-board-similarity penalty term.
5. **Build a `SearchEngine` with a 5-second / 75-candidate budget** (matches our measured throughput). Hill-climb mutation as the default search strategy.
6. **Run it all in a Web Worker** so the UI doesn't block.
7. **Track diversity in production telemetry** — pattern-level metrics (vowel-inventory entropy across the last N boards) not just word-set Jaccard.

Phase 1 acceptance: mean 5+ word count ≥ 100, p10 ≥ 50, vowel-inventory entropy across 100 generations >> 0 (current baseline is 0 because every board has the same vowel inventory).

## What gets cut from the original plan

Re-affirming what the PLAN doc already says, with Phase 0 numbers backing it up:

- **MLflow tracing in browser**: still not viable. Tracer is an abstraction; the MLflow adapter is a Cloudflare Worker proxy. Phase 5.
- **Self-optimizing prompts**: deferred until after Phase 4 recipe memory.
- **Genetic / evolutionary generator**: deferred until hill-climb is shown insufficient.
- **Multi-language support in the intelligence layer**: defer; English first.

## Open follow-ups

- Decide diversity metric weighting (vowel-inventory entropy vs. prefix-family Jaccard vs. recent-board similarity). Recommend instrumenting all three in Phase 1 and picking the best in Phase 2.
- WASM solver: measure speedup vs. JS solver on this machine. If >5×, wire it up in Phase 1 to expand search budget.
- Trie singleton fix: pure refactor, low risk, do it first.
