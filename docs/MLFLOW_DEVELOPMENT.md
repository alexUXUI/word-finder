# MLflow tracing — local dev

Every board generation emits a structured trace. With MLflow Tracking Server running at `localhost:5000`, you can see them live: per-candidate intermediate steps, final scores, selected strategy, and (Phase 2.0c+) every SLM call.

## One-time setup

```sh
# Python 3.10+ recommended
pip install 'mlflow>=2.21'
```

MLflow ≥ 2.21 ships an OTLP/HTTP collector at `/v1/traces` on the tracking server.

## Each session

```sh
# Terminal 1 — MLflow Tracking Server
mlflow server --host 127.0.0.1 --port 5000

# Terminal 2 — your dev / eval runs
MLFLOW_TRACE=1 yarn eval        # routes every search to MLflow
```

Then open [http://127.0.0.1:5000](http://127.0.0.1:5000) in a browser and look for the `**word-finder-eval-v1**` experiment. Each goal × run produces one trace. Click in to see the span tree.

## What a trace looks like

```
search.best-of-n  (TOOL, root)
├── candidate.0  (TOOL)
│   ├── tool.generate  (strategy=frequency-weighted)
│   ├── tool.solve     (total_words=…)
│   └── tool.score     (final_score=…, player_relevant_words=…)
├── candidate.1  …
├── …
└── candidate.74  …

(Phase 2.0c+ adds:)
agent.generate_board  (AGENT, root — wraps everything)
├── model.parse_goal       (CHAT_MODEL — Qwen2.5-0.5B)
├── model.pick_strategy    (CHAT_MODEL)
├── search.best-of-n  …    (existing TOOL subtree)
├── model.reflect          (CHAT_MODEL — between candidates)
└── model.explain          (CHAT_MODEL — why this board)
```

## Configuring the endpoint


| Var / option                           | Default                           | What it does                                                       |
| -------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `MLFLOW_TRACE=1`                       | unset (no tracing)                | Toggles MLflow tracer in `yarn eval`.                              |
| `MLFLOW_OTLP_ENDPOINT`                 | `http://localhost:5000/v1/traces` | Override target endpoint (e.g. point at a remote server).          |
| `MLFLOW_TRACER_OPTIONS.experimentName` | `word-finder`                     | MLflow experiment name.                                            |
| `MLFLOW_TRACER_OPTIONS.silent`         | `false`                           | Suppress export errors (useful for CI where MLflow isn't running). |


## Browser → MLflow (Phase 2.0c+)

Browser POSTs to MLflow directly will be CORS-blocked. When the orchestrator lands, it'll route through a small CORS proxy (`tools/mlflow-proxy/`) that:

1. Listens on `localhost:5001`
2. Has CORS open to `http://localhost:5173`
3. Forwards POSTs to MLflow's OTLP endpoint at `localhost:5000/v1/traces`

The proxy is unnecessary for Node-side runs (`yarn eval`, `yarn bench`, CI) — they POST to MLflow directly.

## Troubleshooting

`**ECONNREFUSED 127.0.0.1:5000**` — MLflow server isn't running. Start it with `mlflow server --port 5000`.

`**404 /v1/traces**` — Your MLflow version is older than 2.21. Upgrade: `pip install --upgrade 'mlflow>=2.21'`.

**Traces never appear in UI** — Check the MLflow server logs for parse errors. The OTLP payload format is strict; if the proxy/tracer changes shape, the server quietly drops bad batches.

`**yarn eval` fails because MLflow isn't up** — Either start MLflow, or run without the tracer: just `yarn eval` (no env var). The MLflowTracer logs export errors but does not fail the run by default; the eval result is unaffected.

## Why MLflow specifically

We picked MLflow because:

- **Free + open source.** No vendor lock-in for a local-dev observability tool.
- **OTLP-compatible.** Standard format — if MLflow stops being a good fit, we point the same emitter at any OTel collector.
- **Built for ML iteration.** Experiments, runs, traces, and metrics all live in one tool. Phase 6 (offline prompt optimization) outputs land in the same UI as production traces.

