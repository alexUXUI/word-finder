/**
 * Tiny MLflow client used by the bench, optimizer, and calibration to log
 * structured runs to the MLflow proxy at localhost:5001 (which forwards
 * to MLflow at localhost:5000). When the proxy isn't running, calls fail
 * silently — tools stay usable offline.
 *
 * The proxy exposes:
 *   POST /traces — span tree (already used by the player UI)
 *   POST /runs   — structured Run with params + metrics + artifacts
 *
 * Schema for /runs:
 *   experiment:    string  (default: 'word-finder-runs', auto-created)
 *   run_name:      string  (display name)
 *   parent_run_id: string?  (nests this run under an open parent)
 *   tags:          { [k]: string }
 *   params:        { [k]: string | number | boolean }
 *   metrics:       { [k]: number } OR { [k]: { value, step }[] } for time-series
 *   artifacts:     { [filename]: string }  (text content, capped 1MB)
 *   status:        'FINISHED' | 'FAILED' | 'RUNNING' (default FINISHED)
 */

const PROXY_URL =
  process.env.MLFLOW_PROXY_URL ?? 'http://localhost:5001/runs';

export interface MlflowRunInput {
  experiment?: string;
  runName: string;
  parentRunId?: string | null;
  tags?: Record<string, string | number | boolean>;
  params?: Record<string, string | number | boolean>;
  metrics?: Record<string, number | { value: number; step: number }[]>;
  artifacts?: Record<string, string>;
  status?: 'FINISHED' | 'FAILED' | 'RUNNING';
}

export interface MlflowRunResult {
  runId: string | null;
  ok: boolean;
}

/**
 * POST a single run to MLflow. Returns the assigned run_id (or null when
 * the proxy is offline). Never throws — bench / optimizer should keep
 * running even when MLflow isn't up.
 */
export const logRun = async (input: MlflowRunInput): Promise<MlflowRunResult> => {
  if (process.env.MLFLOW_DISABLE === '1') {
    return { runId: null, ok: false };
  }
  const payload = {
    experiment: input.experiment ?? 'word-finder-runs',
    run_name: input.runName,
    parent_run_id: input.parentRunId ?? null,
    tags: stringifyMap(input.tags),
    params: stringifyMap(input.params),
    metrics: input.metrics ?? {},
    artifacts: input.artifacts ?? {},
    status: input.status ?? 'FINISHED',
  };
  try {
    const r = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { runId: null, ok: false };
    const body = (await r.json()) as { ok: boolean; run_id?: string };
    return { runId: body.run_id ?? null, ok: !!body.ok };
  } catch {
    return { runId: null, ok: false };
  }
};

const stringifyMap = (
  m?: Record<string, string | number | boolean>
): Record<string, string> => {
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[k] = String(v);
  return out;
};

/**
 * Probe the proxy. Returns true if it answers /health within 1s.
 * Use to decide whether to print a "view runs at localhost:5000" banner.
 */
export const isMlflowProxyReachable = async (): Promise<boolean> => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const r = await fetch(PROXY_URL.replace(/\/runs$/, '/health'), {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
};
