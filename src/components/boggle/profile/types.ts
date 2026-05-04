// Profile data shapes — shared between the PlayerProfile DO (in
// multiplayer-worker) and the Qwik client. Pure TypeScript, no runtime
// dependencies, so it cleanly imports from both sides.

export interface FavoriteBoard {
  id: string;                  // UUID
  board: string;               // 25 chars (size² for size=5)
  size: number;
  score: number;               // playerRelevantWords from the run
  pipelineId: string | null;
  source: 'batch' | 'multiplayer' | 'manual';
  notes: string | null;
  savedAt: number;
}

export interface FriendEntry {
  playerId: string;
  displayName: string;
  addedAt: number;
}

export interface RecentPlayer {
  playerId: string;
  displayName: string;
  /** Most recent multiplayer game name they appeared in. */
  lastGame: string;
  lastSeenAt: number;
}

export interface PlayedGame {
  /** Stable id (UUID) for keyed rendering + future delete. */
  id: string;
  /** Lowercased canonical game name. */
  gameName: string;
  /** Display name from the game (raw cased). */
  gameDisplayName: string;
  /** The shared 25-char board played. */
  board: string;
  size: number;
  /** Final unique-words score for THIS player. */
  myUnique: number;
  /** Total unique words awarded across all players (sum of perPlayer.points). */
  totalUnique: number;
  /** Number of players in the game. */
  playerCount: number;
  /** True iff this player tied for or won outright. */
  won: boolean;
  /** Game start + end timestamps. */
  startedAt: number;
  endedAt: number;
}

export interface PlayerProfileState {
  playerId: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  favoriteBoards: FavoriteBoard[];
  friends: FriendEntry[];
  recentPlayers: RecentPlayer[];
  playedGames: PlayedGame[];
}

// ─────────── HTTP request bodies ───────────

export interface UpdateProfileBody {
  displayName?: string;
}

export interface AddFavoriteBoardBody {
  board: string;
  size: number;
  score: number;
  pipelineId?: string | null;
  source?: 'batch' | 'multiplayer' | 'manual';
  notes?: string | null;
}

export interface AddFriendBody {
  displayName: string;
}

export interface RecordRecentBody {
  displayName: string;
  gameName: string;
}

export interface RecordPlayedGameBody {
  gameName: string;
  gameDisplayName: string;
  board: string;
  size: number;
  myUnique: number;
  totalUnique: number;
  playerCount: number;
  won: boolean;
  startedAt: number;
  endedAt: number;
}
