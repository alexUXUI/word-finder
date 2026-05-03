import type { SavedBoard, PipelineCardScores } from './types';

const SAVED_KEY = 'word-finder.lab.saved';
const PROMPT_KEY = 'word-finder.lab.prompt';
const SCORES_KEY = 'word-finder.lab.scores';
const CHAMPION_KEY = 'word-finder.lab.champion';
const SELECTED_KEY = 'word-finder.lab.selected';

export const loadSavedBoards = (): SavedBoard[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedBoard[]) : [];
  } catch {
    return [];
  }
};

export const persistSavedBoards = (boards: SavedBoard[]): void => {
  try {
    window?.localStorage?.setItem(SAVED_KEY, JSON.stringify(boards));
  } catch {
    /* ignore quota / private browsing */
  }
};

export const loadPrompt = (): string => {
  try {
    return window?.localStorage?.getItem(PROMPT_KEY) ?? '';
  } catch {
    return '';
  }
};

export const persistPrompt = (prompt: string): void => {
  try {
    window?.localStorage?.setItem(PROMPT_KEY, prompt);
  } catch {
    /* ignore */
  }
};

export const loadCardScores = (): PipelineCardScores[] => {
  try {
    const raw = window?.localStorage?.getItem(SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PipelineCardScores[]) : [];
  } catch {
    return [];
  }
};

export const persistCardScores = (scores: PipelineCardScores[]): void => {
  try {
    window?.localStorage?.setItem(SCORES_KEY, JSON.stringify(scores));
  } catch {
    /* ignore */
  }
};

export const loadChampion = (): string | null => {
  try {
    return window?.localStorage?.getItem(CHAMPION_KEY) ?? null;
  } catch {
    return null;
  }
};

export const persistChampion = (id: string): void => {
  try {
    window?.localStorage?.setItem(CHAMPION_KEY, id);
  } catch {
    /* ignore */
  }
};

export const loadSelected = (): string | null => {
  try {
    return window?.localStorage?.getItem(SELECTED_KEY) ?? null;
  } catch {
    return null;
  }
};

export const persistSelected = (id: string): void => {
  try {
    window?.localStorage?.setItem(SELECTED_KEY, id);
  } catch {
    /* ignore */
  }
};
