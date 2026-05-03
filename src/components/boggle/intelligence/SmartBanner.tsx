import { $, component$, useContext } from '@builder.io/qwik';
import { SmartCtx } from '../context';

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
      class="m-auto px-3 my-2 max-w-[420px] text-[13px]"
    >
      {isLoading && (
        <div
          data-testid="smart-banner-status"
          class="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 my-1"
          style="display: flex; align-items: center; gap: 8px;"
        >
          <div
            class="rounded-full bg-blue-500"
            style={`width:${Math.max(8, Math.min(40, smart.modelLoadProgress * 0.4))}px;height:8px;transition:width 0.2s;`}
          />
          <span>Loading SLM ({Math.round(smart.modelLoadProgress)}%)…</span>
        </div>
      )}
      {isGenerating && (
        <div
          data-testid="smart-banner-narration"
          class="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 my-1"
          style="font-family: ui-monospace, monospace; font-size: 12px;"
        >
          <ul style="list-style:none; margin:0; padding:0;">
            {smart.narration.map((line, i) => (
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
              <span style="color:#456;">
                {smart.searchProgress.index}/{smart.searchProgress.total} · best{' '}
                {smart.searchProgress.bestScore.toFixed(0)}
              </span>
            </div>
          )}
          {smart.liveTokens && (
            <div
              data-testid="live-tokens"
              style="margin-top:6px; padding:6px 8px; background:#fff; border-left:3px solid #3b82f6; white-space:pre-wrap; font-style:italic; color:#234;"
            >
              {smart.liveTokens}
              <span style="display:inline-block; width:6px; height:14px; background:#3b82f6; margin-left:2px; vertical-align:middle; animation: blink 1s step-end infinite;">
                &nbsp;
              </span>
            </div>
          )}
        </div>
      )}
      {smart.modelLoadError && (
        <div
          data-testid="smart-banner-error"
          class="rounded-md bg-red-50 border border-red-200 px-3 py-2 my-1 text-red-800"
        >
          SLM error: {smart.modelLoadError}
        </div>
      )}
      {showExplanation && smart.lastFloorMet === false && (
        <div
          data-testid="smart-banner-floor-warning"
          class="rounded-md bg-amber-50 border-l-4 border-amber-500 px-3 py-2 my-1"
          style="font-size: 12px; color: #855;"
        >
          ⚠️ Couldn't reach Min Words target of{' '}
          <strong>{smart.lastFloorTarget}</strong> after {smart.lastAttempts} search
          attempts. Best result: <strong>{smart.lastPlayerRelevantWords}</strong>{' '}
          {(smart.lastFloorTarget ?? 0) > 200
            ? '— that target is at the upper end of what random sampling typically produces. Try a lower Min Words, or wait for hill-climb search.'
            : '— try Reset again, the search is randomized.'}
        </div>
      )}
      {showExplanation && (
        <div
          data-testid="smart-banner-explanation"
          class="rounded-md bg-blue-50 border-l-4 border-blue-500 px-3 py-2 my-1"
          style="font-style: italic; position: relative; padding-right: 32px;"
        >
          <button
            type="button"
            data-testid="smart-banner-dismiss"
            aria-label="Dismiss explanation"
            onClick$={dismiss}
            style="position:absolute; top:4px; right:6px; background:transparent; border:0; cursor:pointer; color:#345; font-size:18px; line-height:1; padding:2px 6px; border-radius:4px; font-style:normal;"
          >
            ×
          </button>
          <div style="color:#225; font-weight:600; font-style: normal;">
            ✨ {smart.lastStrategy} · score {smart.lastFinalScore?.toFixed?.(0) ?? smart.lastFinalScore}
            {smart.lastModelCalls !== undefined ? ` · ${smart.lastModelCalls} model calls` : ''}
            {smart.lastElapsedMs !== undefined ? ` · ${(smart.lastElapsedMs / 1000).toFixed(1)}s` : ''}
            {smart.lastPlayerRelevantWords !== undefined ? ` · ${smart.lastPlayerRelevantWords} words` : ''}
            {smart.lastTotalCandidates !== undefined
              ? ` · best of ${smart.lastTotalCandidates}`
              : ''}
          </div>
          <div data-testid="smart-banner-explanation-text" style="margin-top:4px;">
            {smart.lastExplanation}
          </div>
        </div>
      )}
    </div>
  );
});
