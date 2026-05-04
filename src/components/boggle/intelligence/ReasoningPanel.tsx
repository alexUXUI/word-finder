import { $, component$, Slot, useContext, useTask$ } from '@builder.io/qwik';
import { SmartCtx } from '../context';
import { IconClose, IconSparkle } from '../../shell/icons';

/**
 * Reasoning panel — slide-in right-side surface that shows the FULL
 * generation trace as the SLM works through a board: every narration
 * step, search progress, live token stream, and the final summary card.
 *
 * Replaces the small floating SmartBanner as the primary reasoning
 * surface. The banner stays for the model-download progress only; once a
 * generation starts, this panel auto-opens.
 *
 * State source: SmartCtx (narration[], liveTokens, searchProgress,
 * generationStatus/Stage, lastExplanation/Strategy/FinalScore/etc.)
 */
export const ReasoningPanel = component$(() => {
  const smart = useContext(SmartCtx);

  const close = $(() => { smart.reasoningOpen = false; });

  // Auto-open whenever a generation starts; auto-stay-open through complete.
  useTask$(({ track }) => {
    const status = track(() => smart.generationStatus);
    if (status === 'running') smart.reasoningOpen = true;
  });

  const open = !!smart.reasoningOpen;
  const status = smart.generationStatus;
  const lastBatch = smart.lastBatch ?? [];
  const batch = smart.batchProgress;
  const hasFinal = status === 'complete' && smart.lastExplanation;

  return (
    <aside
      data-testid="reasoning-panel"
      data-state={status}
      data-open={open ? 'true' : 'false'}
      style={`position: fixed; top: 56px; right: 0; bottom: 0; width: min(420px, 95vw); z-index: 60; overflow-y: auto; background: rgba(255,255,255,0.62); backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%); border-left: 1px solid rgba(15,23,42,0.06); box-shadow: -8px 0 24px rgba(15,23,42,0.06); transform: translateX(${open ? '0' : '100%'}); transition: transform 0.22s ease-out;`}
    >
      <div style="padding: 14px 14px 24px; display: flex; flex-direction: column; gap: 14px; font-size: 13px;">
        <header style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; letter-spacing: -0.005em; display: flex; align-items: center; gap: 8px;">
            <span style="color: #f59e0b; display: inline-flex;"><IconSparkle size={16} /></span>
            Reasoning
          </h2>
          <div style="display: flex; align-items: center; gap: 6px;">
            <StatusPill status={status} />
            <button
              type="button"
              data-testid="reasoning-panel-close"
              onClick$={close}
              aria-label="Close panel"
              style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; background: transparent; border: 0; color: #64748b; cursor: pointer; border-radius: 6px;"
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        {/* Idle / no-generation-yet hint */}
        {status === 'idle' && smart.narration.length === 0 && (
          <Card>
            <EmptyHint />
          </Card>
        )}

        {/* Currently-running batch progress */}
        {batch && batch.completed < batch.total && (
          <Card title="Batch progress">
            <Row label="Run" value={`${batch.completed + 1} / ${batch.total}`} />
            <Row label="Best so far" value={`${batch.bestSoFar} player words`} />
            <ProgressBar value={(batch.completed / batch.total) * 100} />
          </Card>
        )}

        {/* Per-candidate search progress */}
        {smart.searchProgress && (
          <Card title="Search">
            <Row label="Evaluated" value={`${smart.searchProgress.index} / ${smart.searchProgress.total}`} />
            <Row label="Best score" value={`${smart.searchProgress.bestScore.toFixed(0)}`} />
            <Row label="Player words (best)" value={`${smart.searchProgress.playerRelevantWords}`} />
            <ProgressBar value={(smart.searchProgress.index / smart.searchProgress.total) * 100} />
          </Card>
        )}

        {/* Narration stream (full history) */}
        {smart.narration.length > 0 && (
          <Card title={`Steps (${smart.narration.length})`}>
            <ol data-testid="reasoning-narration" style="list-style: none; counter-reset: step; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto;">
              {smart.narration.map((line, i) => (
                <li
                  key={i}
                  data-testid="reasoning-step"
                  style="counter-increment: step; display: flex; gap: 10px; align-items: baseline; padding: 6px 8px; border-radius: 6px; background: rgba(15,23,42,0.02); font-family: ui-monospace, SF Mono, Menlo, monospace; font-size: 11.5px; line-height: 1.5; color: #0f172a;"
                >
                  <span style="color: #94a3b8; flex: 0 0 auto; font-variant-numeric: tabular-nums; min-width: 18px; text-align: right;">
                    {i + 1}
                  </span>
                  <span style="flex: 1; min-width: 0; word-break: break-word;">
                    {line}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {/* Live token stream */}
        {smart.liveTokens && status === 'running' && (
          <Card title="Live model output">
            <div
              data-testid="reasoning-live-tokens"
              style="font-family: ui-monospace, SF Mono, Menlo, monospace; font-size: 11.5px; line-height: 1.5; color: #475569; background: rgba(15,23,42,0.03); padding: 8px 10px; border-radius: 6px; max-height: 160px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;"
            >
              {smart.liveTokens}
              <span data-testid="reasoning-cursor" style="display: inline-block; width: 6px; height: 12px; background: #f59e0b; vertical-align: text-bottom; margin-left: 2px; animation: mp-fade-in 0.6s ease-in-out infinite alternate;" />
            </div>
          </Card>
        )}

        {/* Final summary */}
        {hasFinal && (
          <Card title="Result">
            <Row label="Strategy" value={smart.lastStrategy ?? '—'} />
            <Row label="Final score" value={`${smart.lastFinalScore?.toFixed(0) ?? '—'}`} />
            <Row label="Player words" value={`${smart.lastPlayerRelevantWords ?? '—'}`} />
            <Row label="Model calls" value={`${smart.lastModelCalls ?? 0}`} />
            <Row label="Elapsed" value={`${((smart.lastElapsedMs ?? 0) / 1000).toFixed(1)}s`} />
            {smart.lastFloorTarget != null && (
              <Row
                label="Floor"
                value={`${smart.lastFloorTarget} ${smart.lastFloorMet ? '· met ✓' : '· missed'}`}
              />
            )}
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(15,23,42,0.06); font-size: 12.5px; line-height: 1.55; color: #475569; font-style: italic;">
              {smart.lastExplanation}
            </div>
          </Card>
        )}

        {/* Most-recent batch summary table when no live generation */}
        {status !== 'running' && lastBatch.length > 0 && (
          <Card title={`Last batch (${lastBatch.length} runs)`}>
            <BatchMiniTable />
          </Card>
        )}
      </div>
    </aside>
  );
});

export const Card = component$<{ title?: string }>(({ title }) => (
  <section style="background: rgba(255,255,255,0.55); backdrop-filter: blur(10px) saturate(140%); -webkit-backdrop-filter: blur(10px) saturate(140%); border: 1px solid rgba(15,23,42,0.06); border-radius: 12px; padding: 14px;">
    {title && (
      <h3 style="margin: 0 0 10px; font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.10em; text-transform: uppercase;">
        {title}
      </h3>
    )}
    <div style="display: flex; flex-direction: column; gap: 6px;"><Slot /></div>
  </section>
));

export const Row = component$<{ label: string; value: string }>(({ label, value }) => (
  <div style="display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px;">
    <span style="color: #64748b;">{label}</span>
    <span style="color: #0f172a; font-weight: 500; font-variant-numeric: tabular-nums;">{value}</span>
  </div>
));

export const ProgressBar = component$<{ value: number }>(({ value }) => (
  <div style="height: 4px; background: rgba(15,23,42,0.06); border-radius: 2px; overflow: hidden; margin-top: 4px;">
    <div style={`height: 100%; width: ${Math.max(0, Math.min(100, value))}%; background: #f59e0b; transition: width 0.2s;`} />
  </div>
));

export const StatusPill = component$<{ status: string }>(({ status }) => {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    idle:     { bg: 'rgba(15,23,42,0.06)',  fg: '#64748b', label: 'idle' },
    running:  { bg: 'rgba(245,158,11,0.18)', fg: '#92400e', label: 'thinking' },
    complete: { bg: 'rgba(34,197,94,0.16)',  fg: '#166534', label: 'complete' },
    error:    { bg: 'rgba(239,68,68,0.16)',  fg: '#991b1b', label: 'error' },
  };
  const c = colors[status] ?? colors.idle;
  return (
    <span style={`font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: ${c.bg}; color: ${c.fg}; letter-spacing: 0.04em; text-transform: uppercase;`}>
      {c.label}
    </span>
  );
});

export const EmptyHint = component$(() => (
  <div style="padding: 12px 4px; text-align: center; color: #64748b;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 999px; background: rgba(245,158,11,0.10); color: #f59e0b; margin-bottom: 10px;">
      <IconSparkle size={18} />
    </div>
    <div style="font-size: 13px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">
      No generation yet
    </div>
    <div style="font-size: 12px; line-height: 1.5;">
      Click <strong>Reset (Smart)</strong> in Controls to generate a board.<br />
      Each step the SLM takes will appear here in real time.
    </div>
  </div>
));

export const BatchMiniTable = component$(() => {
  const smart = useContext(SmartCtx);
  const rows = (smart.lastBatch ?? []).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <table style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
      <thead>
        <tr style="color: #64748b; text-align: left;">
          <th style="padding: 4px 6px; font-weight: 600;">#</th>
          <th style="padding: 4px 6px; font-weight: 600; text-align: right;">Words</th>
          <th style="padding: 4px 6px; font-weight: 600; text-align: right;">Score</th>
          <th style="padding: 4px 6px; font-weight: 600; text-align: right;">ms</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.idx} style="border-top: 1px solid rgba(15,23,42,0.04);">
            <td style="padding: 4px 6px; color: #475569; font-variant-numeric: tabular-nums;">{r.idx + 1}</td>
            <td style="padding: 4px 6px; text-align: right; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums;">{r.playerRelevantWords}</td>
            <td style="padding: 4px 6px; text-align: right; color: #475569; font-variant-numeric: tabular-nums;">{r.finalScore.toFixed(0)}</td>
            <td style="padding: 4px 6px; text-align: right; color: #94a3b8; font-variant-numeric: tabular-nums;">{r.elapsedMs.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
