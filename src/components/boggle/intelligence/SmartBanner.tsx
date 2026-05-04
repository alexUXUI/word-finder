import { $, component$, useContext } from '@builder.io/qwik';
import { SmartCtx } from '../context';

/**
 * Smart Mode reasoning banner — small floating card pinned just below the
 * top toolbar. Position: fixed so it NEVER inflates the main flow. The
 * board stays at its centered position regardless of what's happening
 * here.
 *
 * Three states:
 *   1. Loading — model download progress bar
 *   2. Generating — narration stream + live tokens + search progress
 *      (narration array is reset between batch runs in Controls.tsx so
 *      the line count never balloons)
 *   3. Complete — explanation card + optional floor-not-met warning,
 *      dismissable
 *
 * Glass-frosted to match the Controls panel and the side panels.
 */
export const SmartBanner = component$(() => {
  const smart = useContext(SmartCtx);

  const isLoading = smart.modelStatus === 'loading';
  const isGenerating = smart.generationStatus === 'running';
  const showExplanation =
    !!smart.lastExplanation &&
    smart.generationStatus === 'complete' &&
    !smart.bannerDismissed;

  if (
    !isLoading &&
    !isGenerating &&
    !showExplanation &&
    !smart.modelLoadError
  ) {
    return null;
  }

  const dismiss = $(() => {
    smart.bannerDismissed = true;
  });

  return (
    <div
      data-testid="smart-banner"
      style="position: fixed; top: 100px; left: 50%; transform: translateX(-50%); width: min(440px, 92vw); z-index: 60; pointer-events: auto;"
    >
      {isLoading && (
        <div
          data-testid="smart-banner-status"
          class="glass"
          style="border-radius: 8px; border: 2px solid #1e3a8a30; padding: 8px 12px; display: flex; align-items: center; gap: 10px; font-size: 13px;"
        >
          <div
            class="rounded-full"
            style={`background:#3b82f6; width:${Math.max(8, Math.min(40, smart.modelLoadProgress * 0.4))}px; height:8px; transition: width 0.2s;`}
          />
          <span style="color:#1e3a8a;">Loading SLM ({Math.round(smart.modelLoadProgress)}%)…</span>
        </div>
      )}

      {isGenerating && (
        <div
          data-testid="smart-banner-narration"
          class="glass"
          style="border-radius: 8px; border: 2px solid #1e3a8a30; padding: 10px 12px; font-family: ui-monospace, monospace; font-size: 12px; max-height: 180px; overflow-y: auto;"
        >
          <div style="font-family: inherit; font-weight:600; color:#1e3a8a; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;">
            ✨ Smart Mode · {smart.batchProgress
              ? `run ${smart.batchProgress.completed + 1}/${smart.batchProgress.total}`
              : 'thinking'}
          </div>
          <ul style="list-style:none; margin:0; padding:0; color:#1e3a8a;">
            {smart.narration.slice(-6).map((line, i) => (
              <li key={i} data-testid="narration-line" style="line-height:1.5;">
                {line}
              </li>
            ))}
          </ul>
          {smart.searchProgress && (
            <div
              data-testid="search-progress"
              style="margin-top:6px; display:flex; align-items:center; gap:6px;"
            >
              <div
                style={`width: ${(smart.searchProgress.index / smart.searchProgress.total) * 200}px; height:6px; background:#3b82f6; border-radius:3px; transition:width 0.1s;`}
              />
              <span style="color:#475569;">
                {smart.searchProgress.index}/{smart.searchProgress.total} · best{' '}
                {smart.searchProgress.bestScore.toFixed(0)}
              </span>
            </div>
          )}
          {smart.batchProgress && smart.batchProgress.total > 1 && (
            <div style="margin-top:6px; font-family: inherit; font-size: 11px; color:#64748b;">
              Best so far: <strong>{smart.batchProgress.bestSoFar}</strong> player words
            </div>
          )}
          {smart.liveTokens && (
            <div
              data-testid="live-tokens"
              style="margin-top:6px; padding:6px 8px; background:rgba(255,255,255,0.5); border-left:3px solid #3b82f6; border-radius: 0 4px 4px 0; white-space:pre-wrap; font-style:italic; color:#1e3a8a;"
            >
              {smart.liveTokens}
            </div>
          )}
        </div>
      )}

      {smart.modelLoadError && (
        <div
          data-testid="smart-banner-error"
          class="glass"
          style="border-radius: 8px; border: 2px solid #dc262640; padding: 8px 12px; color: #991b1b; font-size: 12px;"
        >
          SLM error: {smart.modelLoadError}
        </div>
      )}

      {showExplanation && smart.lastFloorMet === false && (
        <div
          data-testid="smart-banner-floor-warning"
          class="glass"
          style="border-radius: 8px; border-left: 4px solid #f59e0b; border-top: 1px solid rgba(255,255,255,0.4); border-right: 1px solid rgba(255,255,255,0.4); border-bottom: 1px solid rgba(255,255,255,0.4); padding: 8px 12px; margin-top: 4px; font-size: 12px; color: #78350f;"
        >
          ⚠️ Couldn't reach Min Words target of{' '}
          <strong>{smart.lastFloorTarget}</strong> after {smart.lastAttempts} runs.
          Best: <strong>{smart.lastPlayerRelevantWords}</strong>.
        </div>
      )}

      {showExplanation && (
        <div
          data-testid="smart-banner-explanation"
          class="glass"
          style="border-radius: 8px; border-left: 4px solid #2563eb; border-top: 1px solid rgba(255,255,255,0.4); border-right: 1px solid rgba(255,255,255,0.4); border-bottom: 1px solid rgba(255,255,255,0.4); padding: 8px 32px 8px 12px; margin-top: 4px; font-style: italic; position: relative; font-size: 13px;"
        >
          <button
            type="button"
            data-testid="smart-banner-dismiss"
            aria-label="Dismiss explanation"
            onClick$={dismiss}
            style="position:absolute; top:4px; right:6px; background:transparent; border:0; cursor:pointer; color:#1e3a8a; font-size:18px; line-height:1; padding:2px 6px; font-style:normal; border-radius: 4px;"
          >
            ×
          </button>
          <div style="color:#1e3a8a; font-weight:600; font-style: normal; font-size: 12px;">
            ✨ {smart.lastStrategy} · score{' '}
            {smart.lastFinalScore?.toFixed?.(0) ?? smart.lastFinalScore}
            {smart.lastModelCalls !== undefined ? ` · ${smart.lastModelCalls} calls` : ''}
            {smart.lastElapsedMs !== undefined ? ` · ${(smart.lastElapsedMs / 1000).toFixed(1)}s` : ''}
            {smart.lastPlayerRelevantWords !== undefined ? ` · ${smart.lastPlayerRelevantWords} words` : ''}
            {smart.lastTotalCandidates !== undefined
              ? ` · best of ${smart.lastTotalCandidates}`
              : ''}
          </div>
          <div data-testid="smart-banner-explanation-text" style="margin-top:4px; color:#1e3a8a;">
            {smart.lastExplanation}
          </div>
        </div>
      )}
    </div>
  );
});
