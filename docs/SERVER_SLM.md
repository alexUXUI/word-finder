# Server-side SLM — analysis & roadmap

iPhone X-class mobile (3 GB RAM, no WebGPU, iOS Safari ~1.5 GB tab cap) crashes loading any on-device model we've tried — even SmolLM2-135M (110 MB). On-device is genuinely impossible for that hardware class. We need a server-side fallback.

This doc captures the trade-off analysis we did before picking a path, so the decision is auditable and the migration story is explicit.

## Constraints we set

The product preference is, in priority order:

1. **OSS model.** No vendor lock-in to a closed API.
2. **Self-hosted compute.** We control the binary; we can swap models freely.
3. **Flat / predictable cost.** No per-token billing anxiety.
4. **Stay on Cloudflare.** Don't add a new vendor relationship if avoidable.
5. **Architecturally swappable.** Whatever we ship today should not lock us out of switching later.

These are partially contradictory. You can have any three; getting all five is hard.

## Options compared

Sized against a plausible scale: ~1,000 generations/day = 30K/month, each generation = 2 model calls × ~100 tokens.

| Option | Self-hosted | $ at 30K/mo | $ at 300K/mo | Latency (warm) | Cold start | Setup | Stays on Cloudflare |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| **Workers AI** | ❌ managed | ~$0 (free tier) | ~$15 | 1–2 s | none | 30 min | ✅ |
| **Cloudflare Containers + llama.cpp** | ✅ | ~$5–10 | ~$15–30 | 1–3 s | 5–15 s | 1–2 days | ✅ |
| **External VPS (Hetzner CCX13)** | ✅ | ~$15 flat | ~$15 flat | 1–3 s | none (always-on) | 1 day | ❌ |
| **Modal / Replicate (per-sec GPU)** | ✅ image, ❌ infra | ~$5–10 | ~$50–100 | 1–2 s | 10–30 s | ½ day | ❌ |
| **Status quo** | n/a | $0 | $0 | n/a | n/a | n/a | n/a (broken on iPhone X) |

Caveats:
- Workers AI "neuron" pricing is opaque; rough conversion is ~50 neurons per small generation. The free tier (10K neurons/day) likely covers ~30K calls/month.
- Cloudflare Containers prices are still settling — the option is real but newer than Workers AI.
- Flat-rate options beat per-token at ~100K–500K calls/month and above.

## Decision

**Architecture: a Cloudflare Pages Function (`/api/llm`) abstracts the upstream.**

The Function exposes the same JSON shape we use today (`{messages, maxTokens, temperature}` → `{text, elapsedMs}`). The browser-side `CloudflareServerProvider` implements `LocalModelProvider` against this endpoint. Because the abstraction is at the *Pages Function*, we can swap the actual upstream — Workers AI today, self-hosted Container tomorrow — by changing one env var without touching the app.

**Phase 1 (ships immediately, this PR):** Pages Function backed by **Cloudflare Workers AI**. Free at our scale. Unblocks iPhone X today.

**Phase 2 (next iteration):** Replace the upstream with a **Cloudflare Container running llama.cpp** serving an OSS model from Hugging Face. Same Function interface, same provider, same UX.

**Phase 3 (only if scale demands):** Move to dedicated GPU on Hetzner / RunPod. Same Function interface.

## Why this staging

Workers AI is technically *not* self-hosted. Phase 1 ships it anyway because:

1. iPhone X is broken right now. Phase 1 unblocks it in 30 minutes of work.
2. The `LocalModelProvider` interface + the Pages Function indirection mean Phase 2 is a backend swap, not an app change. Sunk cost is zero.
3. At the scale this project will likely hit in the near term, the free tier covers us. There's no actual cost vs. moving to Containers immediately.
4. Container cold-starts (5–15 s loading a 200 MB+ model) on first wakeup are a UX hit we'd have to design around (keep-warm cron, lazy proxy, etc.). Solving that on top of the also-newly-built endpoint stretches Phase 1 to a multi-day arc.

By the time Phase 2 lands, we'll know our actual usage shape and whether Container cold-starts matter.

## What changes for the player

- A new **"Cloudflare Server"** option appears in the SLM Model dropdown (alongside the four on-device options).
- Auto-pick (UA-based) routes iOS UAs to it (since on-device can't survive there).
- Latency: similar to on-device after the model has loaded — ~1–2 s per model call.
- Trace shape: identical. The `model.pick_strategy` and `model.explain` spans are still CHAT_MODEL spans; the only difference is `model_versions.orchestrator` reads `cloudflare-server:@cf/meta/llama-3.2-1b-instruct` instead of a Hugging Face id.

## Implementation map

| File | Role |
| --- | --- |
| `wrangler.toml` (root) | AI binding (`[[ai]] binding = "AI"`) so Pages Functions can call `env.AI.run(...)`. |
| `functions/api/llm.ts` | Pages Function. Validates the request, routes to the configured upstream (Workers AI today; later, fetch the Container endpoint). Returns `{text, elapsedMs, model}` JSON. |
| `src/components/boggle/intelligence/local-model/cloudflare-server-provider.ts` | `LocalModelProvider` implementation. POSTs to `/api/llm`. `load()` is a no-op (the model lives upstream); `isReady` is `true` once constructed. Threads `onToken` if/when the upstream supports streaming (Workers AI streams via SSE). |
| `SLM_REGISTRY` entry | New tier id `cloudflare-server`, `approxSizeMb: 0`, `recommendation: 'low-end'`. UA auto-pick routes iPhone there. |
| `Controls.tsx` | When picking a server tier, skip the model-load progress; instantiate the provider directly. |

## What we lose vs. on-device

- **Offline**: server-side path doesn't work without a connection. On-device path remains for everyone whose device supports it; server is only the floor.
- **Privacy**: prompts leave the device. For a Boggle game this is fine; worth flagging for the docs.
- **Self-hosted**: Phase 1 only. Phase 2 closes the gap.

## Pricing sanity check, recompiled

At the scales the project might hit:

- **Hobbyist (≤ 100 active players, ~6K calls/week)**: Workers AI free tier = $0. Container scale-to-zero ≈ $5–10/mo. Hetzner ≈ $15/mo flat.
- **Modest (≤ 1K active players, ~60K calls/week)**: Workers AI ≈ $20/mo. Container ≈ $20–40/mo. Hetzner still $15/mo flat.
- **Real audience (≥ 10K active players, ~600K calls/week)**: Workers AI ≈ $200/mo. Container ≈ $50–100/mo. Hetzner ≈ $30–60/mo (CCX23/33).

The crossover where flat-rate self-hosted clearly wins is around 100K calls/month. We're not there. We migrate to Container when usage starts costing real money on Workers AI.
