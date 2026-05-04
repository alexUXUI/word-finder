# Distillation — capture · train · serve

Phase H from [`AI_ENGINEERING.md`](./AI_ENGINEERING.md). The shape:

1. **Capture**: run the heavy pipelines (Qwen-0.5B mutator, Llama-1B critic) with `CAPTURE_TRACES=path` set. Every role-level `model.generate` call writes a JSONL record with `(system, user, output, outcome)`.
2. **Format**: convert the JSONL into a chat-template instruction-tuning dataset. Filter to high-outcome rows.
3. **Train**: fine-tune a tiny model (SmolLM2-135M) on the formatted dataset using LoRA (Python).
4. **Export**: convert back to ONNX so Transformers.js can serve it.
5. **Register**: add the distilled model to `SLM_REGISTRY` and a new role implementation that uses it. Bench against the heavy version — should match quality at a fraction of the cost.

The TS code in this repo handles steps 1, 2, and 5. Steps 3 and 4 are Python and live outside the JS pipeline.

## Step 1 — Capture

```sh
# Capture per-role calls into a JSONL during a bench run
CAPTURE_TRACES=evals/traces/p02-mutator.jsonl yarn bench --pipeline=p02-slm-mutator --runs=20 --goal=default-balanced
```

Each record:

```json
{"role":"mutator","roleImpl":"slm-swap","modelId":"transformers-js:qwen2.5-0.5b","system":"You are a Boggle board optimizer...","user":"Board (5x5...): ...","output":"[{\"i\":3,\"j\":17,...}]","elapsedMs":420,"traceId":"gen-...","capturedAt":"...","outcomeFinalScore":312,"outcomePlayerWords":204,"outcomeFloorMet":true}
```

The `outcome*` fields are joined post-hoc — they reflect the *eventual pipeline result* this role call contributed to, not the immediate output of the call. That's what makes the records useful for training: we want to fine-tune on inputs that led to good outcomes.

## Step 2 — Format for training

Filter to high-outcome records and rewrite as chat-template messages.

```python
# tools/distill/format-dataset.py (template)
import json
from pathlib import Path

OUTCOME_FLOOR = 200  # only train on calls that contributed to >=200 player words

src = Path("evals/traces/p02-mutator.jsonl")
dst = Path("evals/traces/p02-mutator.formatted.jsonl")

with src.open() as fin, dst.open("w") as fout:
    for line in fin:
        rec = json.loads(line)
        if rec.get("outcomePlayerWords", 0) < OUTCOME_FLOOR:
            continue
        msg = {
            "messages": [
                {"role": "system", "content": rec["system"]},
                {"role": "user", "content": rec["user"]},
                {"role": "assistant", "content": rec["output"]},
            ]
        }
        fout.write(json.dumps(msg) + "\n")
```

Dataset hygiene:
- **Filter on outcome**: keep only calls whose downstream pipeline cleared a quality bar. Don't reward bad swaps.
- **Diversify by goal**: oversample rare goal categories.
- **Hold out**: split 80/10/10 train/val/test by `traceId` so a single generation's calls land in the same split.

## Step 3 — Fine-tune (Python)

LoRA on a tiny base via `peft` + `trl`. Template:

```python
# tools/distill/train.py (template, run outside the JS pipeline)
from datasets import load_dataset
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE = "HuggingFaceTB/SmolLM2-135M-Instruct"

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE)

ds = load_dataset("json", data_files="evals/traces/p02-mutator.formatted.jsonl", split="train")

cfg = SFTConfig(
    output_dir="tools/distill/checkpoints/smollm-mutator",
    num_train_epochs=3,
    learning_rate=5e-5,
    per_device_train_batch_size=4,
    bf16=True,
    save_strategy="epoch",
)
peft_cfg = LoraConfig(r=16, lora_alpha=32, target_modules="all-linear")

trainer = SFTTrainer(
    model=model,
    tokenizer=tok,
    train_dataset=ds,
    args=cfg,
    peft_config=peft_cfg,
)
trainer.train()
trainer.save_model()
```

Compute target: 8 GB GPU is enough for 135M + LoRA. Train time on 20k role-call examples: ~30 min on a 3090.

## Step 4 — Export to ONNX for Transformers.js

```sh
optimum-cli export onnx \
  --model tools/distill/checkpoints/smollm-mutator \
  --task text-generation \
  --opset 17 \
  tools/distill/exports/smollm-mutator-onnx

optimum-cli onnxruntime quantize \
  --avx512 \
  --onnx_model tools/distill/exports/smollm-mutator-onnx \
  -o tools/distill/exports/smollm-mutator-q4
```

Upload to Hugging Face Hub or bundle as static asset.

## Step 5 — Register the distilled model

Add an entry to `SLM_REGISTRY`:

```ts
{
  id: 'distilled-smollm-mutator',
  modelId: 'word-finder/smollm-mutator-q4',
  approxSizeMb: 110,
  displayName: 'SmolLM2-135M (mutator-distilled)',
  recommendation: 'low-end',
  note: 'Distilled from Qwen-0.5B mutator traces. Specialized for swap proposal only.',
}
```

Then point a pipeline at it via `roleModels`:

```ts
export const p02DistilledMutator: Pipeline = {
  ...p02SlmMutator,
  id: 'p02-distilled-mutator',
  roleModels: { mutator: 'distilled-smollm-mutator' },
};
```

Bench it against `p02-slm-mutator`:

```sh
BENCH_USE_REAL_MODEL=1 yarn bench --pipeline=p02-distilled-mutator
yarn bench:report
```

Promotion criteria:
- Bench delta on `playerRelevantWords` within ±5% of `p02-slm-mutator` (no quality regression)
- Bench delta on `meanElapsedMs` reduced by ≥30% (the point of distillation)
- No regression on Pareto frontier
- Pass the language-safety tests in `tests/unit/intelligence/`

## Caveats

- Distillation is *task-specific*. A model trained on mutator traces won't be a good narrator. Run the capture / train / register loop independently per role.
- Mock-SLM traces are useless training data (mock returns fixed outputs regardless of input). Always capture with `BENCH_USE_REAL_MODEL=1`.
- Dataset bias: if the heavy model has known failure modes, the distilled model inherits them. Audit a sample before trusting the dataset.
- License: training data derived from a model under a permissive license stays usable; check the upstream license before redistributing weights.
