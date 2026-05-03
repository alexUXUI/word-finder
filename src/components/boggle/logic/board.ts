import type { QwikTouchEvent } from '@builder.io/qwik';
import { $ } from '@builder.io/qwik';
import { Language, LetterCubeBgColor } from '../models';
import type {
  LanguageType,
  AnswersState,
  DictionaryState,
  GameState,
  BoardState,
} from '../models';
import { fireworks } from './confetti';
import * as Tone from 'tone';

export const handleClick = $(
  ({
    boardState,
    currentIndex,
    gameState,
    isInSelectedChars,
  }: {
    boardState: BoardState;
    currentIndex: number;
    gameState: GameState;
    isInSelectedChars: boolean;
  }) => {
    const { chars } = boardState;
    const { selectedChars } = gameState;
    const lastCharInPath = selectedChars[selectedChars.length - 1];
    const currentChar = chars[currentIndex];

    updatePath({
      boardState,
      currentIndex,
      gameState,
      isInSelectedChars,
      lastCharInPath,
      currentChar,
    });
  }
);

export const handleTouch = $(
  ({
    boardState,
    gameState,
    e,
  }: {
    boardState: BoardState;
    gameState: GameState;
    e: QwikTouchEvent<HTMLButtonElement>;
  }) => {
    const element = document.elementFromPoint(
      e.targetTouches[0].clientX,
      e.targetTouches[0].clientY
    );
    if (element) {
      const currentIndex = Number.parseInt(
        element.getAttribute('data-cell-index')!
      );
      const currentChar = element.getAttribute('data-cell-char')!;
      const isInSelectedChars = Boolean(
        element.getAttribute('data-cell-is-in-path')
      );

      const lastCharInPath =
        gameState.selectedChars[gameState.selectedChars.length - 1];

      updatePath({
        boardState,
        currentIndex,
        gameState,
        isInSelectedChars,
        lastCharInPath,
        currentChar,
      });
    }
  }
);

export const indexToSound: {
  [key: number]: { sound: string; pitch: string };
} = {
  0: { sound: 'B4', pitch: '8n' },
  1: { sound: 'C5', pitch: '8n' },
  2: { sound: 'D5', pitch: '8n' },
  3: { sound: 'E5', pitch: '8n' },
  4: { sound: 'F5', pitch: '8n' },
  5: { sound: 'G5', pitch: '8n' },
  6: { sound: 'A5', pitch: '8n' },
  7: { sound: 'B5', pitch: '8n' },
  8: { sound: 'C6', pitch: '8n' },
  9: { sound: 'D6', pitch: '8n' },
  10: { sound: 'E6', pitch: '8n' },
  11: { sound: 'F6', pitch: '8n' },
  12: { sound: 'G6', pitch: '8n' },
  13: { sound: 'A6', pitch: '8n' },
  14: { sound: 'B6', pitch: '8n' },
  15: { sound: 'C7', pitch: '8n' },
  16: { sound: 'D7', pitch: '8n' },
  17: { sound: 'E7', pitch: '8n' },
  18: { sound: 'F7', pitch: '8n' },
  19: { sound: 'G7', pitch: '8n' },
  20: { sound: 'A7', pitch: '8n' },
  21: { sound: 'B7', pitch: '8n' },
  22: { sound: 'C8', pitch: '8n' },
  23: { sound: 'D8', pitch: '8n' },
  24: { sound: 'E8', pitch: '8n' },
  25: { sound: 'F8', pitch: '8n' },
  26: { sound: 'G8', pitch: '8n' },
  27: { sound: 'A8', pitch: '8n' },
  28: { sound: 'B8', pitch: '8n' },
  29: { sound: 'C9', pitch: '8n' },
};

export const updatePath = ({
  boardState,
  currentIndex,
  gameState,
  isInSelectedChars,
  lastCharInPath,
  currentChar,
}: {
  boardState: BoardState;
  currentIndex: number;
  gameState: GameState;
  isInSelectedChars: boolean;
  lastCharInPath: { index: number; char: string };
  currentChar: string;
}) => {
  if (!lastCharInPath) {
    gameState.selectedChars = [
      ...gameState.selectedChars,
      {
        index: currentIndex,
        char: currentChar,
      },
    ];

    const lengthOfPath = gameState.selectedChars.length;

    const { sound, pitch } = indexToSound[lengthOfPath];

    const synth = new Tone.MonoSynth({
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.5,
        decay: 0.5,
        sustain: 0.1,
        release: 0.5,
      },
    }).toDestination();
    const now = Tone.now();
    synth.triggerAttackRelease(sound, pitch, now);
    return;
  } else if (lastCharInPath && !isInSelectedChars) {
    const { index } = lastCharInPath;
    const { boardSize } = boardState;
    // 8-neighbor adjacency in (row, col) space — index arithmetic alone wraps
    // at row boundaries (e.g. index+1 from a right-edge cell crosses into the
    // next row's left edge), so check coordinates explicitly.
    const lastRow = Math.floor(index / boardSize);
    const lastCol = index % boardSize;
    const currentRow = Math.floor(currentIndex / boardSize);
    const currentCol = currentIndex % boardSize;
    const isNeighbor =
      Math.abs(lastRow - currentRow) <= 1 &&
      Math.abs(lastCol - currentCol) <= 1 &&
      !(lastRow === currentRow && lastCol === currentCol);
    if (isNeighbor) {
      gameState.selectedChars = [
        ...gameState.selectedChars,
        {
          index: currentIndex,
          char: currentChar,
        },
      ];
      const lengthOfPath = gameState.selectedChars.length;

      const { sound, pitch } = indexToSound[lengthOfPath];

      const synth = new Tone.MonoSynth({
        filterEnvelope: {
          attack: 100,
          octaves: 4,
        },
        oscillator: {
          type: 'sine',
        },
        envelope: {
          attack: 0.5,
          decay: 0.5,
          sustain: 0.1,
          release: 0.5,
        },
      }).toDestination();

      const now = Tone.now();

      synth.triggerAttackRelease(sound, pitch, now);
      return;
    }
    return;
  } else {
    // removing everything from selected node and up in selected chars if already in path
    const index = gameState.selectedChars.findIndex(
      ({ index }: { index: number }) => index === currentIndex
    );
    gameState.selectedChars = gameState.selectedChars.slice(0, index);
  }
};

/**
 * English letter frequencies (approximate, from typical English text corpora).
 * Source-of-truth for English board generation. Replaces the buggy
 * englishVowels/englishConsonants arrays which omitted `o` and `u` and
 * misclassified `s` as a vowel.
 */
export {
  ENGLISH_LETTER_FREQUENCY,
  sampleFromFrequency,
} from './letter-frequency';
import { ENGLISH_LETTER_FREQUENCY, sampleFromFrequency } from './letter-frequency';

/**
 * Legacy entry point used by SSR and Controls.tsx. Mirrors the
 * `frequency-weighted` strategy for English/Spanish and the `legacy-russian`
 * strategy for Russian. New callers should use the strategy registry
 * (`src/components/boggle/generation/registry.ts`) directly so they can pick
 * a specific strategy and capture metadata.
 */
export const randomBoard = (language: LanguageType, length: number): string => {
  const lengthSquared = length * length;
  switch (language) {
    case Language.Russian:
      return _genLegacy(length, Language.Russian);
    case Language.English:
    case Language.Spanish:
    default:
      return sampleFromFrequency(ENGLISH_LETTER_FREQUENCY, lengthSquared).join(
        ''
      );
  }
};

import { generateRandomBoard as _genLegacy } from './legacy-pools';
export { generateRandomBoard } from './legacy-pools';

export const handleFoundWord = $(
  (
    gameState: GameState,
    dictionaryState: DictionaryState,
    answersState: AnswersState,
    audioState: any
  ) => {
    const word = gameState.selectedChars
      .map((element) => element.char)
      .join('')
      .toLocaleLowerCase();

    const isWordInDict =
      Boolean(word.length) && dictionaryState.dictionary.includes(word);
    const isWordNotFound = !answersState.foundWords.includes(word);
    const isWordLongEnough = word.length >= gameState.minCharLength;

    if (isWordInDict && isWordNotFound && isWordLongEnough) {
      gameState.isWordFound = true;
      fireworks();

      if (audioState.foundWord) {
        if (!audioState.foundWord.paused) {
          audioState.foundWord.pause();
          audioState.foundWord.currentTime = 0;
        }
      }

      audioState.foundWord.play();

      setTimeout(() => {
        answersState.foundWords = [...answersState.foundWords, word];
        gameState.isWordFound = false;
        gameState.selectedChars = [];
      }, 300);
    }
  }
);

export const bgColor = (
  isCharSelected: boolean,
  isWordFound: boolean
): LetterCubeBgColor => {
  let cellBgColor;
  switch (true) {
    case isCharSelected && isWordFound:
      cellBgColor = LetterCubeBgColor.WordFound;
      break;
    case isCharSelected:
      cellBgColor = LetterCubeBgColor.Selected;
      break;
    default:
      cellBgColor = LetterCubeBgColor.Unselected;
  }
  return cellBgColor;
};

export {
  englishVowels,
  englishConsonants,
  englishUnpopularConsonants,
  russianVowels,
  russianConsonants,
  russianUnpopularConsonants,
} from './legacy-pools';

export const calculateCellWidth = (boardWidth: number, boardSize: number) => {
  switch (boardSize) {
    case 2:
      return boardWidth / boardSize - 40;
    case 3:
      return boardWidth / boardSize - 20;
    case 4:
      return boardWidth / boardSize - 12;
    case 5:
      return boardWidth / boardSize - boardSize * 2;
    case 6:
      return boardWidth / boardSize - boardSize - 2;
    case 7:
      return boardWidth / boardSize - 6;
    case 8:
      return boardWidth / boardSize - 6;
    case 9:
      return boardWidth / boardSize - 4;
    default:
      return boardWidth / boardSize - 2;
  }
};
