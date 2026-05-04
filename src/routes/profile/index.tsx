import { component$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';
import { ProfilePage } from '~/components/boggle/profile/ProfilePage';

export const head: DocumentHead = {
  title: 'Profile — Word Finder',
};

export default component$(() => <ProfilePage />);
