/**
 * SLM model registry + tier selection.
 *
 * Several browser-runnable instruct models, ordered roughly by size. The UI
 * exposes them in a dropdown so the player can experiment; the auto-pick
 * (User-Agent based) is the default.
 *
 * Storage:
 *   - localStorage["word-finder.slm-id"] holds the user's manual override.
 *     Cleared when the user picks "Auto".
 *   - When unset, selectSlmModel() falls back to UA-based detection.
 *
 * Why this design: iPhone X-class hardware (~3 GB RAM, no WebGPU) OOMs on
 * anything ≥ 220 MB. The picker lets the player walk the list until they
 * find one that loads. Server-side fallback is the next layer if even the
 * tiniest on-device model can't survive.
 */

export type SlmRecommendation =
  | 'low-end'
  | 'modern-mobile'
  | 'desktop'
  | 'experimental';

export interface SlmModel {
  /** Unique key; used in localStorage and as a `<select>` value. */
  readonly id: string;
  /** Hugging Face repo id for `pipeline()`. */
  readonly modelId: string;
  /** Approximate quantized download size, MB. */
  readonly approxSizeMb: number;
  /** Display name shown in the dropdown / banner. */
  readonly displayName: string;
  /** Which device class this is best on. */
  readonly recommendation: SlmRecommendation;
  /** Short note for the dropdown (quality / known issues). */
  readonly note: string;
}

export interface SlmSelection {
  readonly model: SlmModel;
  /** "user preference" / "UA: iPhone" / "UA: Macintosh". */
  readonly reason: string;
}

/**
 * Browser-runnable instruct models that we've vetted with Transformers.js.
 * Order matters — first one is the unconditional fallback.
 */
export const SLM_REGISTRY: readonly SlmModel[] = [
  {
    id: 'smollm2-135m',
    modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    approxSizeMb: 110,
    displayName: 'SmolLM2-135M',
    recommendation: 'low-end',
    note: 'Tiny, fits anywhere. Repetitive output — dedupe protects us.',
  },
  {
    id: 'smollm2-360m',
    modelId: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    approxSizeMb: 220,
    displayName: 'SmolLM2-360M',
    recommendation: 'modern-mobile',
    note: 'Coherent sentences. ~3 GB-RAM iOS may still OOM.',
  },
  {
    id: 'qwen2.5-0.5b',
    modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    approxSizeMb: 786,
    displayName: 'Qwen2.5-0.5B',
    recommendation: 'desktop',
    note: 'Best quality at small size. Desktop only.',
  },
  {
    id: 'llama3.2-1b',
    modelId: 'onnx-community/Llama-3.2-1B-Instruct',
    approxSizeMb: 1100,
    displayName: 'Llama-3.2-1B',
    recommendation: 'experimental',
    note: 'Higher quality but big. Modern desktop GPU recommended.',
  },
];

const FALLBACK_DESKTOP = SLM_REGISTRY.find((m) => m.id === 'qwen2.5-0.5b')!;
const FALLBACK_MOBILE = SLM_REGISTRY.find((m) => m.id === 'smollm2-360m')!;

const STORAGE_KEY = 'word-finder.slm-id';

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

const uaSummary = (ua: string): string => {
  const m = ua.match(
    /(iPhone|iPad|iPod|Android|Mobile|Macintosh|Windows|Linux|CrOS)/i
  );
  return m ? m[1] : ua.slice(0, 32);
};

export const readSlmPreference = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setSlmPreference = (id: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (id === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // ignore — private browsing / quota
  }
};

export const selectSlmModel = (): SlmSelection => {
  // 1. User preference (persisted via setSlmPreference).
  const pref = readSlmPreference();
  if (pref) {
    const found = SLM_REGISTRY.find((m) => m.id === pref);
    if (found) return { model: found, reason: 'user preference' };
  }

  // 2. UA-based.
  if (typeof navigator === 'undefined') {
    return { model: FALLBACK_DESKTOP, reason: 'no navigator (SSR)' };
  }
  const ua = navigator.userAgent;
  if (looksLikeMobile(ua)) {
    return { model: FALLBACK_MOBILE, reason: `UA: ${uaSummary(ua)}` };
  }
  return { model: FALLBACK_DESKTOP, reason: `UA: ${uaSummary(ua)}` };
};

// Backwards-compat shim — earlier code called selectSlmTier() and read
// .id / .modelId / .approxSizeMb / .displayName off it.
export interface SlmTier {
  readonly id: string;
  readonly modelId: string;
  readonly approxSizeMb: number;
  readonly displayName: string;
  readonly reason: string;
}

export const selectSlmTier = (): SlmTier => {
  const sel = selectSlmModel();
  return {
    id: sel.model.id,
    modelId: sel.model.modelId,
    approxSizeMb: sel.model.approxSizeMb,
    displayName: sel.model.displayName,
    reason: sel.reason,
  };
};
