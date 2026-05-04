import { component$, useSignal, useTask$ } from '@builder.io/qwik';
import type { PropFunction } from '@builder.io/qwik';

export interface SlmPickerProps {
  disabled?: boolean;
  onPick$: PropFunction<(id: string) => void>;
}

interface SlmOption {
  id: string;
  displayName: string;
  approxSizeMb: number;
  recommendation: string;
  note: string;
}

/**
 * Lazy-loads the model registry so a player who never opens Controls
 * doesn't pay the import cost. Auto option clears the persisted
 * preference; named options write through to localStorage via the
 * parent's onPick$ handler.
 */
export const SlmPicker = component$<SlmPickerProps>(({ disabled, onPick$ }) => {
  const options = useSignal<SlmOption[] | null>(null);
  const currentValue = useSignal<string>('auto');

  useTask$(async () => {
    if (typeof window === 'undefined') return;
    const { SLM_REGISTRY, readSlmPreference } = await import(
      '../intelligence/local-model'
    );
    options.value = SLM_REGISTRY.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      approxSizeMb: m.approxSizeMb,
      recommendation: m.recommendation,
      note: m.note,
    }));
    currentValue.value = readSlmPreference() ?? 'auto';
  });

  return (
    <select
      id="slm-picker"
      data-testid="slm-picker"
      data-current={currentValue.value}
      disabled={disabled}
      class="text-[13px] rounded-md w-fit min-w-[12ch] h-[36px] border-2 border-blue-900 px-2 bg-white"
      onChange$={(_, el) => {
        currentValue.value = el.value;
        onPick$(el.value);
      }}
      value={currentValue.value}
    >
      <option value="auto">Auto (User-Agent)</option>
      {(options.value ?? []).map((m) => (
        <option key={m.id} value={m.id}>
          {`${m.displayName} (~${m.approxSizeMb} MB · ${m.recommendation})`}
        </option>
      ))}
    </select>
  );
});
