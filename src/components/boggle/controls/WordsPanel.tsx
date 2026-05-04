import { component$, useContext, useStore } from '@builder.io/qwik';
import { WordsList } from './WordsList';
import { AnswersCtx } from '../context';
import { WordListType } from '../models';

export const WordsPanel = component$(() => {
  const answersState = useContext(AnswersCtx);
  const wordPanelState = useStore<{
    activeTab: WordListType | null;
  }>({
    activeTab: null,
  });

  return (
    <div class="flex justify-center w-full py-4 mt-4">
      <WordsList
        words={answersState.foundWords}
        variant={'foundWords'}
        wordPanelState={wordPanelState}
      />
      <WordsList
        words={answersState.answers}
        variant={'answers'}
        wordPanelState={wordPanelState}
      />
    </div>
  );
});
