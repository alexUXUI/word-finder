import { component$ } from '@builder.io/qwik';
import { loader$ } from '@builder.io/qwik-city';
import type { DocumentHead, Loader } from '@builder.io/qwik-city';
import { BoogleRoot } from '~/components/boggle/BoggleRoot';
import type { ServerData } from '~/components/boggle/logic/server';
import { handleGet } from '~/components/boggle/logic/server';

export const head: DocumentHead = {
  title: 'Word Finder',
  meta: [
    {
      name: 'description',
      content: 'Word Finder — find every word hiding in the grid.',
    },
  ],
};

export default component$(() => {
  const boggleData = useBoggleData();
  return <BoogleRoot data={boggleData.value} />;
});

export const useBoggleData: Loader<ServerData> = loader$(
  ({ url, request }): ServerData => handleGet({ url, request })
);
