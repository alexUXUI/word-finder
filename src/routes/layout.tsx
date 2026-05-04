import { component$, Slot } from '@builder.io/qwik';
import { ChromeShell } from '~/components/shell/ChromeShell';

export default component$(() => {
  return (
    <ChromeShell>
      <Slot />
    </ChromeShell>
  );
});
