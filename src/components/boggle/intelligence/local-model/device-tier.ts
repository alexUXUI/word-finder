/**
 * Pick the right SLM for the device.
 *
 * iPhone X / iPhone-class hardware (≤ 3-4 GB RAM, no WebGPU) crashes when
 * we try to load Qwen2.5-0.5B (~786 MB). iOS Safari kills tabs at ~1.5 GB
 * resident, so we need a smaller model on mobile/low-end devices.
 *
 * Three signals, in priority order:
 *   1. URL query (?slmTier=small|large) — testing override
 *   2. navigator.deviceMemory (Chromium-only; rounded to powers of 2 GB)
 *   3. user-agent heuristic (last resort; iOS / Android → small)
 *
 * False-negative cost (treating a powerful device as small): mediocre
 * explanations. False-positive cost (treating a low-end device as
 * powerful): tab crash. We default to safe.
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
 * Pull deviceMemory if present. Chromium-only; Safari and Firefox return undefined.
 * Documented values are rounded to {0.25, 0.5, 1, 2, 4, 8} GB.
 */
const readDeviceMemory = (): number | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof dm === 'number' ? dm : undefined;
};

const readQuery = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('slmTier');
    return v === 'small' || v === 'large' ? v : undefined;
  } catch {
    return undefined;
  }
};

/**
 * UA heuristic — coarse but reliable for "is this a phone/tablet". Used
 * only when navigator.deviceMemory is unavailable (Safari, Firefox).
 */
const looksLikeMobile = (ua: string): boolean => {
  // iPhone, iPad, iPod, Android phones+tablets, mobile browsers.
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua)) return true;
  if (/Mobile/i.test(ua)) return true;
  // iPad on iPadOS 13+ reports as Macintosh; touch points distinguish it.
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

export const selectSlmTier = (): SlmTier => {
  // 1. Manual override.
  const overridden = readQuery();
  if (overridden === 'small') {
    return { ...TIER_SMALL, reason: 'override:?slmTier=small' };
  }
  if (overridden === 'large') {
    return { ...TIER_LARGE, reason: 'override:?slmTier=large' };
  }

  // 2. deviceMemory (Chromium). Most accurate when present.
  const dm = readDeviceMemory();
  if (typeof dm === 'number') {
    if (dm < 4) {
      return {
        ...TIER_SMALL,
        reason: `deviceMemory=${dm}GB < 4`,
      };
    }
    return { ...TIER_LARGE, reason: `deviceMemory=${dm}GB ≥ 4` };
  }

  // 3. UA heuristic (Safari, Firefox).
  if (typeof navigator === 'undefined') {
    return { ...TIER_LARGE, reason: 'no navigator (SSR)' };
  }
  if (looksLikeMobile(navigator.userAgent)) {
    return {
      ...TIER_SMALL,
      reason: 'UA-mobile (no deviceMemory available)',
    };
  }
  return { ...TIER_LARGE, reason: 'UA-desktop' };
};
