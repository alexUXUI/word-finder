import type { SavedBoard } from './types';

const SAVED_KEY = 'word-finder.builder.saved';
const PROMPT_KEY = 'word-finder.builder.prompt';

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
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(boards));
  } catch {
    // private browsing / quota — non-fatal
  }
};

export const loadPrompt = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(PROMPT_KEY) ?? '';
  } catch {
    return '';
  }
};

export const persistPrompt = (prompt: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROMPT_KEY, prompt);
  } catch {
    // ignore
  }
};
