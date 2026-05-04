import {
  $,
  component$,
  useOnWindow,
  useStore,
  useContextProvider,
  noSerialize,
  useTask$,
  useBrowserVisibleTask$,
} from '@builder.io/qwik';

import { useLocation } from '@builder.io/qwik-city';
import { Controls } from './controls/Controls';
import { WordsPanel } from './controls/WordsPanel';
import { BoggleBoard } from './board/Board';
import { ReasoningPanel } from './intelligence/ReasoningPanel';
import { PipelineLab } from './lab/PipelineLab';
import { BatchDashboard } from './dashboard/BatchDashboard';
import { VersionFooter } from './VersionFooter';
import { installVersionGlobals } from '../../version';
import { calculateCellWidth, handleFoundWord, handleFoundWordForMultiplayer } from './logic/board';
import {
  DictionaryCtx,
  BoardCtx,
  GameCtx,
  AnswersCtx,
  WorkerCtx,
  SmartCtx,
  BuilderCtx,
  MultiplayerCtx,
} from './context';
import type { SmartState, BuilderState, MultiplayerState, MultiplayerEventEntry } from './context';
import { MultiplayerPanel } from './multiplayer/MultiplayerPanel';
import { MultiplayerClient, buildGameUrl } from './multiplayer/client';
import {
  getOrCreatePlayerId,
  getDisplayName,
  setDisplayName as persistDisplayName,
  recordRecentGame,
  readRecentGames,
} from './multiplayer/storage';
import { recordRecentPlayer, recordPlayedGame } from './profile/api';
import BoggleWorker from './worker?worker';

import type {
  BoardState,
  GameState,
  AnswersState,
  DictionaryState,
  WebWorkerState,
  LanguageType,
} from './models';
import { UserGameStats } from './user/UserGameStats';

export interface BoggleProps {
  data: {
    board: string[];
    boardWidth: number;
    boardSize: number;
    language: LanguageType;
    minCharLength: number;
    minWordsPerBoard: number;
    attemptsPerReset: number;
  };
}

export const BoogleRoot = component$(({ data }: BoggleProps) => {
  const { board, boardWidth, boardSize, language, minCharLength, minWordsPerBoard, attemptsPerReset } = data;
  const loc = useLocation();

  const dictionaryState = useStore<DictionaryState>({ dictionary: [] });

  const boardState = useStore<BoardState>({
    chars: board,
    boardSize: boardSize ?? 0,
    boardWidth: boardWidth ?? 0,
    cellWidth: calculateCellWidth(boardWidth, boardSize),
  });

  const gameState = useStore<GameState>({
    isWordFound: false,
    selectedChars: [],
    language: language,
    minCharLength: minCharLength ?? 0,
    minWordsPerBoard: minWordsPerBoard ?? 150,
    attemptsPerReset: attemptsPerReset ?? 10,
    currentLevel: 1,
    wordsUntilNextLevel: 1,
    levelStepSize: 1,
  });

  const answersState = useStore<AnswersState>({
    answers: [],
    foundWords: [],
  });

  const workerState = useStore<WebWorkerState>({ mod: null });

  const audioState = useStore<{ foundWord: HTMLAudioElement | null }>({
    foundWord: null,
  });

  const smartState = useStore<SmartState>({
    // Smart Mode is the default. The model itself is *not* downloaded
    // until the first Reset Board click — until then the SSR board stands
    // and the toggle simply reads "Smart Mode: ON".
    enabled: true,
    modelStatus: 'idle',
    modelLoadProgress: 0,
    generationStatus: 'idle',
    narration: [],
    liveTokens: '',
    bannerDismissed: false,
    refs: {},
  });

  const builderState = useStore<BuilderState>({
    open: false,
    prompt: '',
    isRunning: false,
    cancelRequested: false,
    runsCompleted: 0,
    runsTotal: 0,
    batchResults: [],
    savedBoards: [],
  });

  const multiplayerState = useStore<MultiplayerState>({
    panelOpen: false,
    playerId: '',
    displayName: '',
    pendingGameName: '',
    game: null,
    connectionStatus: 'idle',
    lastError: null,
    recentEvents: [],
    lastResults: null,
    recentGames: [],
    hasSwappedBoard: false,
    refs: {},
  }, { deep: true });

  useOnWindow(
    'DOMContentLoaded',
    $(() => {
      if (window.Worker) {
        const worker = new BoggleWorker();
        workerState.mod = noSerialize(worker);
        if (workerState.mod) {
          workerState.mod.postMessage({
            language: gameState.language,
            board: boardState.chars,
            minCharLength: gameState.minCharLength,
            isDictionaryLoaded: dictionaryState.dictionary.length,
          });
          workerState.mod.onmessage = (event) => {
            if (!dictionaryState.dictionary.length) {
              dictionaryState.dictionary = event.data.dictionary;
            }
            answersState.answers = event.data.answers;
          };
        }
      }
      const wowAudioFile = '/wow.mp3';
      const audio = new Audio(wowAudioFile);
      audioState.foundWord = audio;

      // Wire version metadata into discoverable surfaces:
      //   - window.__APP_VERSION__
      //   - localStorage["word-finder.version"]
      //   - DevTools console banner
      installVersionGlobals();
    })
  );

  useTask$(async ({ track }) => {
    track(() => gameState.selectedChars);
    if (!gameState.selectedChars.length) return;
    // In a multiplayer "playing" game the server is authoritative — we
    // emit the candidate word and let the server's `player_found` echo
    // populate the local found-words list (mirrored in a separate task
    // below). In any other state, fall through to the original
    // single-player path that commits locally.
    const inLiveMpGame =
      multiplayerState.game?.state === 'playing' && multiplayerState.refs.client;
    if (inLiveMpGame) {
      const word = await handleFoundWordForMultiplayer(
        gameState, dictionaryState, answersState, audioState,
      );
      if (word) multiplayerState.refs.client?.send({ type: 'found', word });
      return;
    }
    handleFoundWord(gameState, dictionaryState, answersState, audioState);
  });

  useTask$(({ track }) => {
    track(() => answersState.foundWords);
    if (answersState.foundWords) {
      if (gameState.wordsUntilNextLevel === 0) {
        gameState.currentLevel = gameState.currentLevel + 1;
        gameState.wordsUntilNextLevel = gameState.currentLevel;
        gameState.levelStepSize = gameState.currentLevel;
      }

      gameState.wordsUntilNextLevel = gameState.wordsUntilNextLevel - 1;
    }
  });

  useContextProvider(DictionaryCtx, dictionaryState);
  useContextProvider(BoardCtx, boardState);
  useContextProvider(GameCtx, gameState);
  useContextProvider(AnswersCtx, answersState);
  useContextProvider(WorkerCtx, workerState);
  useContextProvider(SmartCtx, smartState);
  useContextProvider(BuilderCtx, builderState);
  useContextProvider(MultiplayerCtx, multiplayerState);

  // ─── Panel-opener via URL query. The LeftNav links to /?panel=<x>;
  // this task watches the query and flips the matching panel open.
  // Re-runs on URL change (Qwik City's useLocation is reactive), so
  // clicking the same link with a different panel works too.
  useTask$(({ track }) => {
    const panel = track(() => loc.url.searchParams.get('panel'));
    if (panel === 'multiplayer') {
      multiplayerState.panelOpen = true;
    } else if (panel === 'builder') {
      builderState.open = true;
    } else if (panel === 'stats') {
      smartState.dashboardOpen = true;
    } else if (panel === 'reasoning') {
      smartState.reasoningOpen = true;
    }
  });

  // ─── Multiplayer hydration: load identity + recent games on first paint.
  // Also parse ?game= / ?name= deep-link params and pre-fill the form.
  useBrowserVisibleTask$(() => {
    if (!multiplayerState.playerId) {
      multiplayerState.playerId = getOrCreatePlayerId();
    }
    if (!multiplayerState.displayName) {
      multiplayerState.displayName = getDisplayName();
    }
    multiplayerState.recentGames = readRecentGames();
    try {
      const params = new URLSearchParams(window.location.search);
      const game = params.get('game');
      const name = params.get('name');
      if (game) multiplayerState.pendingGameName = game.toLowerCase();
      if (name && !multiplayerState.displayName) multiplayerState.displayName = name;
      if (game && (multiplayerState.displayName || name)) {
        // Deep-link auto-open the panel so the form is visible (or, if
        // the join task fires below, the player rolls straight into the
        // lobby).
        multiplayerState.panelOpen = true;
      }
    } catch { /* ignore: URLSearchParams should not throw, but be safe in tests */ }
  });

  // ─── Multiplayer connect: when both pendingGameName and displayName are
  // set and there is no live client, instantiate one and connect. Subsequent
  // changes to the form fields after a client exists are applied via
  // setDisplayName + reconnect on disconnect.
  useBrowserVisibleTask$(({ track, cleanup }) => {
    const game = track(() => multiplayerState.pendingGameName);
    const name = track(() => multiplayerState.displayName);
    if (!game || !name || multiplayerState.refs.client) return;

    persistDisplayName(name);
    recordRecentGame(game);
    multiplayerState.recentGames = readRecentGames();

    const appendEvent = (partial: Omit<MultiplayerEventEntry, 'id' | 'ts'>): void => {
      const id = (multiplayerState.recentEvents[multiplayerState.recentEvents.length - 1]?.id ?? 0) + 1;
      multiplayerState.recentEvents = [
        ...multiplayerState.recentEvents.slice(-19),
        { id, ts: Date.now(), ...partial },
      ];
    };

    const client = new MultiplayerClient({
      url: buildGameUrl(game),
      playerId: multiplayerState.playerId,
      displayName: name,
      gameName: game,
      onFrame: (frame) => {
        // Authoritative state replaces the local mirror.
        if (frame.type === 'state') {
          multiplayerState.game = frame.state;
          return;
        }
        if (frame.type === 'player_joined') {
          if (multiplayerState.game) {
            multiplayerState.game.players[frame.player.id] = frame.player;
          }
          appendEvent({
            kind: 'joined',
            text: `${frame.player.displayName} joined`,
            playerId: frame.player.id,
          });
          return;
        }
        if (frame.type === 'player_left') {
          if (multiplayerState.game?.players?.[frame.playerId]) {
            multiplayerState.game.players[frame.playerId].connected = false;
          }
          const pName = multiplayerState.game?.players?.[frame.playerId]?.displayName ?? 'someone';
          appendEvent({
            kind: 'left',
            text: `${pName} left`,
            playerId: frame.playerId,
          });
          return;
        }
        if (frame.type === 'player_found') {
          const p = multiplayerState.game?.players?.[frame.playerId];
          if (p && !p.foundWords.includes(frame.word)) {
            p.foundWords = [...p.foundWords, frame.word];
          }
          const pName = p?.displayName ?? 'someone';
          appendEvent({
            kind: 'found',
            text:
              frame.playerId === multiplayerState.playerId
                ? `you found ${frame.word.toUpperCase()}`
                : `${pName} found a word (${frame.totalCount})`,
            playerId: frame.playerId,
          });
          return;
        }
        if (frame.type === 'player_ready') {
          const p = multiplayerState.game?.players?.[frame.playerId];
          if (p) p.readyToEnd = frame.ready;
          return;
        }
        if (frame.type === 'game_started') {
          if (multiplayerState.game) {
            multiplayerState.game.state = 'playing';
            multiplayerState.game.board = frame.board;
            multiplayerState.game.startedAt = frame.startedAt;
            multiplayerState.game.pipelineId = frame.pipelineId;
          }
          appendEvent({
            kind: 'started',
            text: 'Game started — find unique words!',
          });
          return;
        }
        if (frame.type === 'game_ended') {
          if (multiplayerState.game) {
            multiplayerState.game.state = 'ended';
            multiplayerState.game.endedAt = frame.endedAt;
          }
          multiplayerState.lastResults = frame.results;
          appendEvent({ kind: 'ended', text: 'Game ended' });
          // Record opponents in this player's "recent players" list AND
          // archive the game itself into played-games. Both fire-and-forget
          // — failures are non-fatal (no UI surface) since the game is over.
          const myId = multiplayerState.playerId;
          const gameLabel = multiplayerState.game?.displayName ?? game;
          for (const row of frame.results.perPlayer) {
            if (row.playerId === myId) continue;
            recordRecentPlayer(myId, row.playerId, {
              displayName: row.displayName,
              gameName: gameLabel,
            }).catch(() => { /* swallow — best-effort */ });
          }
          // Played-game archive — one entry per game per player.
          const me = frame.results.perPlayer.find((p) => p.playerId === myId);
          const totalUnique = frame.results.perPlayer.reduce(
            (s, p) => s + p.points, 0,
          );
          if (me && multiplayerState.game) {
            recordPlayedGame(myId, {
              gameName: game,
              gameDisplayName: gameLabel,
              board: multiplayerState.game.board,
              size: multiplayerState.game.boardSize,
              myUnique: me.points,
              totalUnique,
              playerCount: frame.results.perPlayer.length,
              won: frame.results.winnerIds.includes(myId),
              startedAt: multiplayerState.game.startedAt ?? frame.endedAt,
              endedAt: frame.endedAt,
            }).catch(() => { /* swallow */ });
          }
          return;
        }
        if (frame.type === 'error') {
          multiplayerState.lastError = `${frame.code}: ${frame.message}`;
          appendEvent({
            kind: 'error',
            text: `${frame.code}: ${frame.message}`,
          });
          // Auto-clear after 4s so it doesn't linger.
          setTimeout(() => {
            if (multiplayerState.lastError === `${frame.code}: ${frame.message}`) {
              multiplayerState.lastError = null;
            }
          }, 4000);
        }
      },
      onStatus: (s) => {
        multiplayerState.connectionStatus = s;
      },
    });
    multiplayerState.refs.client = noSerialize(client);
    client.connect();

    cleanup(() => {
      try { client.disconnect(); } catch { /* noop */ }
      multiplayerState.refs.client = noSerialize(undefined as unknown as MultiplayerClient);
    });
  });

  // ─── Board swap: when a multiplayer game enters 'playing' with a board,
  // save the local board and replace boardState.chars with the shared one.
  // The Worker re-solves automatically off chars change. On exit (left game
  // or ended), restore the local board so single-player keeps working.
  useTask$(({ track }) => {
    const mpBoard = track(() => multiplayerState.game?.board ?? '');
    const lifecycle = track(() => multiplayerState.game?.state ?? null);
    const inPlay = lifecycle === 'playing' && mpBoard.length > 0;
    if (inPlay && !multiplayerState.hasSwappedBoard) {
      // First entry into playing: snapshot local board for later restore.
      multiplayerState.refs.savedBoardChars = noSerialize([...boardState.chars]);
      multiplayerState.refs.savedBoardSize = boardState.boardSize;
      const size = multiplayerState.game!.boardSize;
      boardState.boardSize = size;
      boardState.chars = mpBoard.split('');
      boardState.cellWidth = calculateCellWidth(boardState.boardWidth, size);
      // Clear the previous found-words from any prior local session so the
      // multiplayer game starts at zero on this client.
      answersState.foundWords = [];
      multiplayerState.hasSwappedBoard = true;
      // Re-trigger solver: Controls.tsx watches boardState.chars but the
      // Worker setup in BoggleRoot only ran on initial DOMContentLoaded.
      // Forward the swap explicitly.
      try {
        workerState.mod?.postMessage({
          language: gameState.language,
          board: boardState.chars,
          minCharLength: gameState.minCharLength,
          isDictionaryLoaded: dictionaryState.dictionary.length,
        });
      } catch { /* noop */ }
    } else if (!inPlay && multiplayerState.hasSwappedBoard && multiplayerState.refs.savedBoardChars) {
      // Game ended OR player left — restore the local board so the
      // single-player UX returns to where it was.
      const saved = multiplayerState.refs.savedBoardChars;
      const savedSize = multiplayerState.refs.savedBoardSize ?? boardState.boardSize;
      boardState.chars = [...saved];
      boardState.boardSize = savedSize;
      boardState.cellWidth = calculateCellWidth(boardState.boardWidth, savedSize);
      multiplayerState.hasSwappedBoard = false;
      try {
        workerState.mod?.postMessage({
          language: gameState.language,
          board: boardState.chars,
          minCharLength: gameState.minCharLength,
          isDictionaryLoaded: dictionaryState.dictionary.length,
        });
      } catch { /* noop */ }
    }
  });

  // ─── Mirror server-confirmed words for THIS player into the local
  // foundWords list — so the existing WordsPanel shows them. Server is
  // authoritative; we never push optimistically here.
  useTask$(({ track }) => {
    const myWords =
      track(() => multiplayerState.game?.players?.[multiplayerState.playerId]?.foundWords)
      ?? [];
    if (multiplayerState.game?.state !== 'playing' && multiplayerState.game?.state !== 'ended') return;
    // Only add words we don't already have, never remove (server should
    // never shrink, but if it did we don't want to drop UI state).
    const existing = new Set(answersState.foundWords);
    const additions = myWords.filter((w) => !existing.has(w));
    if (additions.length === 0) return;
    answersState.foundWords = [...answersState.foundWords, ...additions];
  });

  return (
    <div
      data-testid="play-page"
      style="display: flex; flex-direction: column; align-items: center; max-width: 720px; margin: 0 auto; padding: 8px 12px 32px;"
    >
      <Controls />
      <UserGameStats />
      <BoggleBoard />
      <WordsPanel />
      <VersionFooter />
      {/* Right-side slide-in panels — out of normal flow (position: fixed) */}
      <BatchDashboard />
      <PipelineLab />
      <MultiplayerPanel />
      <ReasoningPanel />
    </div>
  );
});
