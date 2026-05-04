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

export interface PlayerProfileState {
  playerId: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  favoriteBoards: FavoriteBoard[];
  friends: FriendEntry[];
  recentPlayers: RecentPlayer[];
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
