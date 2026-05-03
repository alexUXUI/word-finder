/**
 * Pick the right SLM for the device.
 *
 * iPhone X / iPhone-class hardware (≤ 3-4 GB RAM, no WebGPU) crashes when
 * we try to load Qwen2.5-0.5B (~786 MB). iOS Safari kills tabs at ~1.5 GB
 * resident, so we need a smaller model on mobile/low-end devices.
 *
 * Detection: User-Agent only. Mobile UA → small tier; desktop UA → large.
 *
 * False-negative cost (treating a powerful device as small): mediocre
 * explanations. False-positive cost (treating a low-end device as
 * powerful): tab crash. UA-based detection defaults to safe — every
 * phone / tablet gets the small model regardless of how powerful it
 * thinks it is, because we'd rather sacrifice some quality than crash.
 */

export interface SlmTier {
  id: 'small' | 'large';
  modelId: string;
  /** Approximate quantized size on disk, MB. For UI hints only. */
  approxSizeMb: number;
  /** Display name surfaced in UI. */
  displayName: string;
  /** Reason this tier was chosen — for telemetry / debugging. */
  reason: string;
}

const TIER_LARGE: Omit<SlmTier, 'reason'> = {
  id: 'large',
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  approxSizeMb: 786,
  displayName: 'Qwen2.5-0.5B (large)',
};

const TIER_SMALL: Omit<SlmTier, 'reason'> = {
  id: 'small',
  // SmolLM2-360M is the smallest instruct model that produces *coherent*
  // free-form sentences. The 135M version repeats itself uncontrollably
  // and we'd rather pay an extra ~100 MB than ship word salad.
  modelId: 'HuggingFaceTB/SmolLM2-360M-Instruct',
  approxSizeMb: 220,
  displayName: 'SmolLM2-360M (small)',
};

/**
 * Mobile-UA detection. Catches iPhone, iPad, iPod, Android phones+tablets,
 * and any browser that self-identifies as Mobile. Also handles iPadOS 13+
 * which spoofs as Macintosh — touch-point count gives it away.
 */
const looksLikeMobile = (ua: string): boolean => {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua)) return true;
  if (/Mobile/i.test(ua)) return true;
  if (
    /Macintosh/i.test(ua) &&
    typeof navigator !== 'undefined' &&
    (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints &&
    (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
};

/**
 * Truncated UA string for the chosen-tier `reason` field. Useful in MLflow
 * traces and DevTools to confirm what was detected without dumping the
 * whole UA into the SmartBanner.
 */
const uaSummary = (ua: string): string => {
  const m = ua.match(
    /(iPhone|iPad|iPod|Android|Mobile|Macintosh|Windows|Linux|CrOS)/i
  );
  return m ? m[1] : ua.slice(0, 32);
};

export const selectSlmTier = (): SlmTier => {
  if (typeof navigator === 'undefined') {
    // SSR — return a sensible default. The actual decision happens on the
    // client when ensureSmartLoaded() runs after hydration.
    return { ...TIER_LARGE, reason: 'no navigator (SSR)' };
  }
  const ua = navigator.userAgent;
  if (looksLikeMobile(ua)) {
    return { ...TIER_SMALL, reason: `UA: ${uaSummary(ua)}` };
  }
  return { ...TIER_LARGE, reason: `UA: ${uaSummary(ua)}` };
};
