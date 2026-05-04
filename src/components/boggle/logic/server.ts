import parser from 'ua-parser-js';
import { randomBoard } from './board';
import { Language } from '../models';
import type { LanguageType } from '../models';

export interface ServerData {
  board: string[];
  boardWidth: number;
  boardSize: number;
  language: LanguageType;
  minCharLength: number;
  minWordsPerBoard: number;
  attemptsPerReset: number;
}

type ReqArgs = {
  url: URL;
  request: Request;
};

export const gameConfig = {
  boardSize: 5,
  // Default to 5+ letter words — that's the gameplay we optimize for.
  // Override per-request via ?min=N.
  minCharLength: 5,
  // Smart Mode hard floor: never accept a board with fewer player-relevant
  // words than this. Override via ?minWords=N. Non-smart Reset ignores it.
  minWordsPerBoard: 150,
  // Number of independent pipeline runs per Reset. Best is shown to the
  // player; all N go to the dashboard. Override via ?attempts=N.
  attemptsPerReset: 10,
  language: Language.English,
};

export const handleGet = ({ url, request }: ReqArgs): ServerData => {
  let language = gameConfig.language;
  let minCharLength = gameConfig.minCharLength;
  let minWordsPerBoard = gameConfig.minWordsPerBoard;
  let attemptsPerReset = gameConfig.attemptsPerReset;
  let boardSize = gameConfig.boardSize;

  let board = randomBoard(language, boardSize).split('');

  const boardWidth = boardWidthFromRequest(request);
  const paramsObject = Object.fromEntries(url.searchParams);

  if (paramsObject.language) {
    language = paramsObject.language;
  }

  if (paramsObject.board) {
    board = paramsObject.board.split('');
  }

  if (paramsObject.size) {
    boardSize = parseInt(paramsObject.size);
  }

  if (paramsObject.min) {
    minCharLength = parseInt(paramsObject.min);
  }

  if (paramsObject.minWords) {
    const parsed = parseInt(paramsObject.minWords);
    if (Number.isFinite(parsed) && parsed >= 0) {
      minWordsPerBoard = parsed;
    }
  }

  if (paramsObject.attempts) {
    const parsed = parseInt(paramsObject.attempts);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 50) {
      attemptsPerReset = parsed;
    }
  }

  return {
    board,
    boardWidth,
    boardSize,
    language,
    minCharLength,
    minWordsPerBoard,
    attemptsPerReset,
  };
};

export const boardWidthFromRequest = (request: Request) => {
  const userAgent = parser(request.headers.get('user-agent') || '');
  const OS = userAgent.os;
  const isAndroid = OS.name === 'Android';
  const isIOS = OS.name === 'iOS';
  const isMac = OS.name === 'Mac OS';
  const isWindows = OS.name === 'Windows';
  const isChromeOS = OS.name === 'Chrome OS';

  if (isAndroid || isIOS) {
    return 350;
  } else if (isMac || isWindows || isChromeOS) {
    return 400;
  }

  return 0;
};
