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
      {(isLoading || isGenerating) && (
        <div
          data-testid="smart-banner-status"
          class="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 my-1"
          style="display: flex; align-items: center; gap: 8px;"
        >
          <div
            class="rounded-full bg-blue-500"
            style={`width:${Math.max(8, Math.min(40, smart.modelLoadProgress * 0.4))}px;height:8px;transition:width 0.2s;`}
          />
          <span>
            {isLoading
              ? `Loading SLM (${Math.round(smart.modelLoadProgress)}%)…`
              : `Generating · ${smart.generationStage ?? 'thinking'}`}
          </span>
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
          </div>
          <div data-testid="smart-banner-explanation-text" style="margin-top:4px;">
            {smart.lastExplanation}
          </div>
        </div>
      )}
    </div>
  );
});
